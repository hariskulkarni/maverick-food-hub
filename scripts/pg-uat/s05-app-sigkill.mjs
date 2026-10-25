// S5: app SIGKILLed after the allocation commit and before outbox processing; after restart the
// worker releases the order exactly once. Uses the S4-A order (OBSERVED, UTR 610400000141).
import { note, save, scenario, staffLogin, snapOrder, sqlVal, worker, importStatement, kitchenOrderIds, todayIst, sleep } from './uat-lib.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
const UAT = process.env.UAT_DIR;
scenario('s05-app-sigkill-after-allocation');
const orderId = sqlVal(`select "orderId" from "PgPaymentAttempt" where "observedUtr"='610400000141'`);
const payable = sqlVal(`select "payableAmountPaise" from "PgPaymentAttempt" where "orderId"='${orderId}'`);
const accId = sqlVal(`select id from "PgReceivingAccount" where status='VERIFIED' limit 1`);
const admin = await staffLogin('admin');
const imp = await importStatement(admin, accId, [{ date: todayIst(), ref: '610400000141', amount: (Number(payable) / 100).toFixed(2) }], 's05-statement.csv');
// Kill immediately: allocation committed inside the import request, outbox row not yet processed.
const pid = fs.readFileSync(`${UAT}/app.pid`, 'utf8').trim();
execFileSync('kill', ['-9', pid]);
note(`statement import -> ${imp.status}; SIGKILL app pid ${pid} at ${new Date().toISOString()}`);
snapOrder('db-1-after-kill.txt', orderId);
const s1 = sqlVal(`select (select status from "Payment" where "orderId"='${orderId}')||'|'||(select status from "PgOutbox" where "aggregateId"='${orderId}')||'|'||(select status from "Order" where id='${orderId}')`);
note(`after kill: payment|outbox|order = ${s1}`);
note(`EXPECT CAPTURED|PENDING|PAYMENT_PENDING (allocation committed, release not yet run): ${ok(s1 === 'CAPTURED|PENDING|PAYMENT_PENDING')}`);
await sleep(1000);
const out = execFileSync('bash', [`${process.cwd()}/../../scripts/pg-uat/start-app.sh`], { encoding: 'utf8', env: process.env });
note(`app restarted: ${out.trim()}`);
for (let i = 0; i < 3; i++) save(`worker-${i}.json`, (await worker()).json);
snapOrder('db-2-after-restart-worker.txt', orderId);
const s2 = sqlVal(`select (select status from "Payment" where "orderId"='${orderId}')||'|'||(select status||'/'||attempts from "PgOutbox" where "aggregateId"='${orderId}')||'|'||(select status from "Order" where id='${orderId}')`);
const rel = sqlVal(`select count(*) from "OrderStatusEvent" where "orderId"='${orderId}' and status='RECEIVED'`);
note(`after restart + 3 worker ticks: payment|outbox/attempts|order = ${s2}; RECEIVED status events = ${rel}`);
note(`EXPECT released exactly once (order RECEIVED, outbox DONE, one RECEIVED event): ${ok(s2.startsWith('CAPTURED|DONE/') && s2.endsWith('|RECEIVED') && rel === '1')}`);
const kitchen = await staffLogin('kitchen');
note(`EXPECT visible in kitchen: ${ok((await kitchenOrderIds(kitchen)).includes(orderId))}`);
save('ids.json', { orderId });
