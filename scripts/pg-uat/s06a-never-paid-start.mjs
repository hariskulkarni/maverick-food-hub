// S6 part A: a never-paid session. Customer places a PG order; the gateway session is never
// signed into or paid. A retry while the attempt is AWAITING_PAYMENT must NOT mint a new attempt.
// Part B (s06b) runs after expiresAt (15 min TTL) + 30 min STALE_GRACE_MS have really elapsed.
import { APP, http, note, save, scenario, customerLogin, placePgOrder, snapOrder, sqlVal, item } from './uat-lib.mjs';
scenario('s06-never-paid-expiry');
const cust = await customerLogin('+910000000106');
const r = await placePgOrder(cust, item('Masala Chai')); // Masala Chai x1
const orderId = r.json.orderId;
save('ids.json', { orderId, customerPhone: '+910000000106', placedAt: new Date().toISOString() });
note(`order ${orderId} status=${sqlVal(`select status from "Order" where id='${orderId}'`)} checkoutUrl=${r.json.payment?.redirectUrl}`);
const retry = await http('POST', `${APP}/api/orders/${orderId}/pay`, { jar: cust });
const n = sqlVal(`select count(*) from "PgPaymentAttempt" where "orderId"='${orderId}'`);
note(`EXPECT retry while AWAITING_PAYMENT reuses the same attempt (attempts=1): ${n === '1' && retry.status === 200 ? 'PASS' : 'FAIL'} (attempts=${n}, http=${retry.status})`);
snapOrder('db-A-after-place.txt', orderId);
