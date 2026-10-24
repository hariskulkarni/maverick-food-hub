// S6 part B + S2 part B (run after expiresAt + 30 min STALE_GRACE_MS have really elapsed; no clock
// manipulation): the expiry stage expires the never-paid attempt -> order PAYMENT_FAILED, and the
// customer may then retry (a NEW attempt). The OBSERVED-but-unbanked S2 attempt, equally old, is
// NOT expired (only flagged STALE_PENDING).
import { APP, http, note, save, scenario, snapOrder, sqlVal, worker, customerLogin } from './uat-lib.mjs';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
const E = process.env.EVID || '/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s';
const s06 = JSON.parse(fs.readFileSync(`${E}/s06-never-paid-expiry/ids.json`, 'utf8'));
const s02 = JSON.parse(fs.readFileSync(`${E}/s02-paid-no-bank-credit/ids.json`, 'utf8'));
scenario('s06-never-paid-expiry');
const now = new Date().toISOString();
note(`now=${now}; s06 attempt expiresAt=${sqlVal(`select "expiresAt" from "PgPaymentAttempt" where "orderId"='${s06.orderId}'`)}; s02 attempt expiresAt=${sqlVal(`select "expiresAt" from "PgPaymentAttempt" where "orderId"='${s02.orderId}'`)} (UTC)`);
const w = await worker();
save('worker-expiry.json', w.json);
snapOrder('db-B-after-expiry.txt', s06.orderId);
const a = sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${s06.orderId}'`);
const o = sqlVal(`select status from "Order" where id='${s06.orderId}'`);
const p = sqlVal(`select status from "Payment" where "orderId"='${s06.orderId}'`);
note(`EXPECT never-paid attempt EXPIRED, Payment FAILED, order PAYMENT_FAILED (${a}|${p}|${o}): ${ok(a === 'EXPIRED' && p === 'FAILED' && o === 'PAYMENT_FAILED')}`);
const cust = await customerLogin(s06.customerPhone);
const retry = await http('POST', `${APP}/api/orders/${s06.orderId}/pay`, { jar: cust });
const n = sqlVal(`select count(*) from "PgPaymentAttempt" where "orderId"='${s06.orderId}'`);
const latest = sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${s06.orderId}' order by "createdAt" desc limit 1`);
note(`EXPECT retry after PAYMENT_FAILED opens a NEW attempt (attempts=${n}, newest=${latest}, http=${retry.status}): ${ok(retry.status === 200 && n === '2' && latest === 'AWAITING_PAYMENT')}`);
snapOrder('db-C-after-retry.txt', s06.orderId);

scenario('s02-paid-no-bank-credit');
const a2 = sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${s02.orderId}'`);
const o2 = sqlVal(`select status from "Order" where id='${s02.orderId}'`);
const stale = sqlVal(`select count(*) from "PgReconException" where "orderId"='${s02.orderId}' and kind='STALE_PENDING'`);
const alloc = sqlVal(`select count(*) from "PgAllocation" where "orderId"='${s02.orderId}'`);
note(`EXPECT past-expiry OBSERVED attempt NOT expired: still OBSERVED, order PAYMENT_PENDING, no allocation, flagged STALE_PENDING (${a2}|${o2}|alloc=${alloc}|stale=${stale}): ${ok(a2 === 'OBSERVED' && o2 === 'PAYMENT_PENDING' && alloc === '0' && stale === '1')}`);
snapOrder('db-B-after-expiry-window.txt', s02.orderId);
