// S8: refund of a bank-captured Flavrly PG order (S1 order): restaurant cancels -> platform requests a
// manual bank refund -> a DIFFERENT user approves -> completed with a fake bank reference ->
// Payment REFUNDED, order REFUNDED. Wallet credit is refused (policy flag off); completing before
// approval is refused.
import { APP, http, note, save, scenario, staffLogin, snapOrder, sqlVal, snap } from './uat-lib.mjs';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
const s01 = JSON.parse(fs.readFileSync(`${process.env.EVID || '/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s'}/s01-happy-path/ids.json`, 'utf8'));
scenario('s08-refund');
const orderId = s01.orderId;
const sup = await staffLogin('super');
const admin = await staffLogin('admin');
const admin2 = await staffLogin('admin2');
const amount = Number(sqlVal(`select "amountPaise" from "PgAllocation" where "orderId"='${orderId}' and kind='ORDER_PAYMENT'`)) / 100;

await http('POST', `${APP}/api/admin/orders/${orderId}/transition`, { jar: admin, body: { status: 'CANCELLED_BY_RESTAURANT', note: 'UAT S8: synthetic cancellation' } });
const w = await http('POST', `${APP}/api/platform/orders/${orderId}`, { jar: sup, body: { amount, destination: 'WALLET', reason: 'UAT S8 wallet attempt' } });
note(`EXPECT wallet refund refused for direct UPI: ${ok(w.status === 409)}`);
const req = await http('POST', `${APP}/api/platform/orders/${orderId}`, { jar: sup, body: { amount, destination: 'ORIGINAL_PAYMENT', reason: 'UAT S8: customer cancelled (synthetic)' } });
const refundId = req.json?.refundId;
const early = await http('POST', `${APP}/api/admin/pg/refunds/${refundId}`, { jar: admin2, body: { action: 'COMPLETE', bankReference: 'UATREFUND0001', note: 'premature' } });
note(`EXPECT complete before approval refused: ${ok(early.status === 409)}`);
await http('POST', `${APP}/api/admin/pg/refunds/${refundId}`, { jar: admin, body: { action: 'APPROVE' } });
const done = await http('POST', `${APP}/api/admin/pg/refunds/${refundId}`, {
  jar: admin2,
  body: { action: 'COMPLETE', bankReference: 'UATREFUND0001', note: 'Synthetic UAT: no real transfer; fake bank reference', attachmentRef: 'uat://none' },
});
snap('db.txt', `select r.id, r.status, r.amount, r.destination, r."providerRef", p."requestedById" <> p."approvedById" as two_person, p."approvedById" is not null as approved, p."completedAt" is not null as completed, p."bankReference", p."allocationKind" from "Refund" r join "PgRefundRecord" p on p."refundId"=r.id where r.id='${refundId}'`);
snap('db.txt', `select kind, "amountPaise", "dedupeKey" from "PgFinancialEvent" where "orderId"='${orderId}' order by "createdAt"`);
snapOrder('db-order.txt', orderId);
const s = sqlVal(`select (select status from "Payment" where "orderId"='${orderId}')||'|'||(select status from "Order" where id='${orderId}')||'|'||(select state from "PgPaymentAttempt" where "orderId"='${orderId}')`);
note(`EXPECT Payment REFUNDED, order REFUNDED, attempt REFUNDED (${s}): ${ok(done.status === 200 && s === 'REFUNDED|REFUNDED|REFUNDED')}`);
save('ids.json', { orderId, refundId });
