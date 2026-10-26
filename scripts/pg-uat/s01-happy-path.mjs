// S1 happy path: order -> AWAITING_PAYMENT -> synthetic payment at gateway -> signed webhook ->
// OBSERVED (+UTR, payable) -> still PAYMENT_PENDING, not in kitchen -> CSV statement credit ->
// pg-worker -> CAPTURED + allocation + outbox DONE -> RECEIVED and visible in kitchen.
import { note, save, scenario, staffLogin, snapOrder, sqlVal, worker, importStatement, kitchenOrderIds, todayIst, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved, gatewayDeliveries } from './flow.mjs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s01-happy-path');
const accId = sqlVal(`select id from "PgReceivingAccount" where status='VERIFIED' limit 1`);
const kitchen = await staffLogin('kitchen');
const admin = await staffLogin('admin');

const { orderId, sessionId } = await orderAndOpenCheckout('+910000000101', item('Butter Naan')); // Butter Naan
save('ids.json', { orderId, sessionId });
note(`EXPECT attempt AWAITING_PAYMENT: ${ok(sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${orderId}'`) === 'AWAITING_PAYMENT')}`);
snapOrder('db-1-after-place.txt', orderId);

const payable = await payerActivate(sessionId, '9000000101');
const utr = '610100000101';
await simulatePaid(sessionId, payable, utr);
await waitObserved(orderId);
const a = sqlVal(`select state||'|'||coalesce("observedUtr",'')||'|'||coalesce("payableAmountPaise"::text,'')||'|'||"expectedAmountPaise" from "PgPaymentAttempt" where "orderId"='${orderId}'`);
note(`attempt after webhook: ${a}`);
const [st, u, pay, exp] = a.split('|');
note(`EXPECT OBSERVED + UTR + payable within [expected, expected+99]: ${ok(st === 'OBSERVED' && u === utr && +pay >= +exp && +pay <= +exp + 99)}`);
await gatewayDeliveries('gateway-deliveries.json');
snapOrder('db-2-after-webhook.txt', orderId);
note(`EXPECT order PAYMENT_PENDING: ${ok(sqlVal(`select status from "Order" where id='${orderId}'`) === 'PAYMENT_PENDING')}`);
note(`EXPECT order absent from kitchen API: ${ok(!(await kitchenOrderIds(kitchen)).includes(orderId))}`);
await worker();
note(`EXPECT still PAYMENT_PENDING after worker w/o bank credit: ${ok(sqlVal(`select status from "Order" where id='${orderId}'`) === 'PAYMENT_PENDING')}`);

const rupees = (Number(pay) / 100).toFixed(2);
const imp = await importStatement(admin, accId, [{ date: todayIst(), ref: utr, amount: rupees }], `s01-statement-${utr}.csv`);
note(`statement import -> ${imp.status} inserted=${imp.json?.insertedCount}`);
const w = await worker();
save('worker-after-import.json', w.json);
snapOrder('db-3-after-import-and-worker.txt', orderId);
const pstat = sqlVal(`select status from "Payment" where "orderId"='${orderId}'`);
const alloc = sqlVal(`select count(*) from "PgAllocation" where "orderId"='${orderId}' and kind='ORDER_PAYMENT' and "reversedAt" is null`);
const ob = sqlVal(`select status from "PgOutbox" where "aggregateId"='${orderId}' and topic='ORDER_RELEASE'`);
const os = sqlVal(`select status from "Order" where id='${orderId}'`);
note(`EXPECT Payment CAPTURED=${pstat}, 1 ORDER_PAYMENT allocation=${alloc}, outbox DONE=${ob}, order RECEIVED=${os}: ${ok(pstat === 'CAPTURED' && alloc === '1' && ob === 'DONE' && os === 'RECEIVED')}`);
note(`EXPECT order visible in kitchen API: ${ok((await kitchenOrderIds(kitchen)).includes(orderId))}`);
