// S7: receiving account disabled for new sessions (disabledForNewAt) -> new checkout refused, the
// in-flight attempt still reconciles to capture and release.
import { APP, http, note, save, scenario, staffLogin, snapOrder, sqlVal, snap, worker, importStatement, kitchenOrderIds, todayIst, customerLogin, placePgOrder, BRANCH_ID, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved } from './flow.mjs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s07-disabled-merchant');
const accId = sqlVal(`select id from "PgReceivingAccount" where status='VERIFIED' limit 1`);
const sup = await staffLogin('super');
const admin = await staffLogin('admin');
const kitchen = await staffLogin('kitchen');

// In-flight attempt opened BEFORE the disable.
const inflight = await orderAndOpenCheckout('+910000000107', item('Cola (300ml)')); // Cola
const payable = await payerActivate(inflight.sessionId, '9000000107');

await http('POST', `${APP}/api/platform/youpi/accounts/${accId}`, { jar: sup, body: { action: 'DISABLE_NEW', reason: 'UAT S7: block new sessions' } });
snap('db.txt', `select id, status, "disabledForNewAt" from "PgReceivingAccount" where id='${accId}'`);

// New checkout must be refused.
const cust2 = await customerLogin('+910000000171');
const page = await http('GET', `${APP}/checkout?branchId=${BRANCH_ID()}`, { jar: cust2, quiet: true });
const pgOffered = /youpiEnabled\\?":true/.test(page.text);
note(`GET /checkout -> ${page.status}; youpiEnabled offered=${pgOffered}`);
const n0 = sqlVal(`select count(*) from "PgPaymentAttempt"`);
const r = await placePgOrder(cust2, item('Cola (300ml)'));
const n1 = sqlVal(`select count(*) from "PgPaymentAttempt"`);
const ordersForCust = sqlVal(`select count(*) from "Order" where "customerId"='${cust2.userId}'`);
note(`EXPECT new PG checkout refused (no checkout URL, no new attempt [${n0}->${n1}], orders for this customer=${ordersForCust}, http ${r.status}; checkout page does not offer PG): ${ok(!r.json?.payment && n0 === n1 && !pgOffered && (ordersForCust === '0' || !!r.json?.paymentError))}`);
if (r.json?.orderId) {
  const retry = await http('POST', `${APP}/api/orders/${r.json.orderId}/pay`, { jar: cust2 });
  note(`EXPECT retry-pay also refused: ${ok(retry.status >= 400)}`);
}

// In-flight attempt still reconciles.
await simulatePaid(inflight.sessionId, payable, '610700000107');
await waitObserved(inflight.orderId);
const pay = sqlVal(`select "payableAmountPaise" from "PgPaymentAttempt" where "orderId"='${inflight.orderId}'`);
await importStatement(admin, accId, [{ date: todayIst(), ref: '610700000107', amount: (Number(pay) / 100).toFixed(2) }], 's07-statement.csv');
await worker();
const s = sqlVal(`select (select status from "Payment" where "orderId"='${inflight.orderId}')||'|'||(select status from "Order" where id='${inflight.orderId}')`);
note(`EXPECT in-flight attempt captured and released while disabled (${s}): ${ok(s === 'CAPTURED|RECEIVED' && (await kitchenOrderIds(kitchen)).includes(inflight.orderId))}`);
snapOrder('db-inflight.txt', inflight.orderId);
if (r.json?.orderId) snapOrder('db-refused.txt', r.json.orderId);

// Restore for the remaining scenarios.
await http('POST', `${APP}/api/platform/youpi/accounts/${accId}`, { jar: sup, body: { action: 'ENABLE_NEW', reason: 'UAT S7 done' } });
snap('db.txt', `select id, status, "disabledForNewAt" from "PgReceivingAccount" where id='${accId}'`);
save('ids.json', { inflightOrderId: inflight.orderId, refusedOrderId: r.json?.orderId ?? null });
