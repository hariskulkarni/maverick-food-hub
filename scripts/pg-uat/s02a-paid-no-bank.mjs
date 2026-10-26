// S2 part A: gateway says paid (signed webhook), but no bank credit ever arrives.
// Same item as S1 so the fork's paise offset kicks in (payable != expected).
import { note, save, scenario, staffLogin, snapOrder, sqlVal, worker, kitchenOrderIds, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved } from './flow.mjs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s02-paid-no-bank-credit');
const kitchen = await staffLogin('kitchen');
const { orderId, sessionId } = await orderAndOpenCheckout('+910000000102', item('Butter Naan'));
save('ids.json', { orderId, sessionId });
const payable = await payerActivate(sessionId, '9000000102');
await simulatePaid(sessionId, payable, '610200000102');
await waitObserved(orderId);
for (let i = 0; i < 3; i++) await worker();
const a = sqlVal(`select state||'|'||coalesce("payableAmountPaise"::text,'')||'|'||"expectedAmountPaise" from "PgPaymentAttempt" where "orderId"='${orderId}'`);
note(`attempt: ${a} (payable vs expected shows the fork paise offset)`);
note(`EXPECT order PAYMENT_PENDING, attempt OBSERVED, 0 allocations, Payment PENDING: ${ok(
  sqlVal(`select status from "Order" where id='${orderId}'`) === 'PAYMENT_PENDING' && a.startsWith('OBSERVED|') &&
  sqlVal(`select count(*) from "PgAllocation" where "orderId"='${orderId}'`) === '0' &&
  sqlVal(`select status from "Payment" where "orderId"='${orderId}'`) === 'PENDING')}`);
note(`EXPECT absent from kitchen: ${ok(!(await kitchenOrderIds(kitchen)).includes(orderId))}`);
snapOrder('db-A.txt', orderId);
