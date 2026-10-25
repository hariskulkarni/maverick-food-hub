// S9 part B: FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false (app restarted with the flag off) hides Flavrly PG at
// checkout and refuses new PG orders, while webhook + worker keep processing an attempt that was
// opened before the switch.
import { APP, http, note, save, scenario, staffLogin, snapOrder, sqlVal, worker, importStatement, kitchenOrderIds, todayIst, customerLogin, placePgOrder, BRANCH_ID, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved } from './flow.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
const UAT = process.env.UAT_DIR;
scenario('s09-rollback-and-flag');
function restartApp(flagOff) {
  if (flagOff) fs.writeFileSync(`${UAT}/app.override.env`, 'FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false\n');
  else fs.rmSync(`${UAT}/app.override.env`, { force: true });
  const pid = fs.readFileSync(`${UAT}/app.pid`, 'utf8').trim();
  execFileSync('kill', ['-TERM', pid]);
  execFileSync('bash', ['-c', `for i in $(seq 1 30); do kill -0 ${pid} 2>/dev/null || exit 0; sleep 1; done; exit 1`]);
  const out = execFileSync('bash', [`${process.cwd()}/../../scripts/pg-uat/start-app.sh`], { encoding: 'utf8', env: process.env });
  note(`app restarted with FLAVRLY_PG_NEW_PAYMENTS_ENABLED=${flagOff ? 'false' : 'true'}: ${out.trim()}`);
}
const accId = sqlVal(`select id from "PgReceivingAccount" where status='VERIFIED' limit 1`);
const offered = async (jar) => /youpiEnabled\\?":true/.test((await http('GET', `${APP}/checkout?branchId=${BRANCH_ID()}`, { jar, quiet: true })).text);

// In-flight attempt opened while the flag is on.
let inflight, payable;
if (process.env.S09_RESUME) {
  // Resume after a transport hiccup: the in-flight order was opened (flag on) in the first run.
  inflight = JSON.parse(process.env.S09_RESUME);
  payable = inflight.payable;
  note(`resuming with in-flight order ${inflight.orderId} (opened while flag on); app already restarted with flag off`);
  restartApp(true); // re-apply flag off with the loopback-only bind
} else {
  inflight = await orderAndOpenCheckout('+910000000109', item('Masala Chai'));
  payable = await payerActivate(inflight.sessionId, '9000000109');
  const probe = await customerLogin('+910000000191');
  note(`flag on: checkout offers PG = ${await offered(probe)}`);
  restartApp(true);
}
const probe2 = await customerLogin('+910000000192');
const off = await offered(probe2);
const n0 = sqlVal(`select count(*) from "PgPaymentAttempt"`);
const r = await placePgOrder(probe2, item('Masala Chai'));
const n1 = sqlVal(`select count(*) from "PgPaymentAttempt"`);
note(`EXPECT flag off: PG hidden at checkout (offered=${off}) and new PG order refused (http ${r.status}, attempts ${n0}->${n1}): ${ok(!off && r.status !== 200 && n0 === n1)}`);

await simulatePaid(inflight.sessionId, payable, '610900000109');
await waitObserved(inflight.orderId);
const admin = await staffLogin('admin');
const pay = sqlVal(`select "payableAmountPaise" from "PgPaymentAttempt" where "orderId"='${inflight.orderId}'`);
await importStatement(admin, accId, [{ date: todayIst(), ref: '610900000109', amount: (Number(pay) / 100).toFixed(2) }], 's09-statement.csv');
save('worker-flag-off.json', (await worker()).json);
const kitchen = await staffLogin('kitchen');
const s = sqlVal(`select (select status from "Payment" where "orderId"='${inflight.orderId}')||'|'||(select status from "Order" where id='${inflight.orderId}')`);
note(`EXPECT flag off: in-flight webhook accepted, worker captured+released (${s}), visible in kitchen: ${ok(s === 'CAPTURED|RECEIVED' && (await kitchenOrderIds(kitchen)).includes(inflight.orderId))}`);
snapOrder('db-inflight.txt', inflight.orderId);

restartApp(false);
const probe3 = await customerLogin('+910000000193');
note(`flag restored: checkout offers PG = ${await offered(probe3)}`);
save('ids.json', { inflightOrderId: inflight.orderId });
