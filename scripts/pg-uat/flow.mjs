// Reusable synthetic payment journey: customer order -> gateway payer activates -> simulated bank alert.
import { APP, GW, http, note, save, customerLogin, placePgOrder, sqlVal, gatewayPayerActivate, gatewaySimulatePaid, waitFor, gwAdmin } from './uat-lib.mjs';
import { execFileSync } from 'node:child_process';

export async function orderAndOpenCheckout(phone, menuItemId) {
  const cust = await customerLogin(phone);
  const r = await placePgOrder(cust, menuItemId);
  const orderId = r.json?.orderId;
  const sessionId = r.json?.payment?.providerOrderId;
  const checkoutUrl = r.json?.payment?.redirectUrl;
  let tls = 'n/a';
  try {
    tls = execFileSync('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', checkoutUrl], { encoding: 'utf8' });
  } catch {}
  note(`checkout URL ${checkoutUrl} via local TLS proxy -> HTTP ${tls}`);
  return { cust, orderId, sessionId, checkoutUrl, placeStatus: r.status };
}

/** Payer signs in at the gateway checkout, taps "payment done"; returns payable rupees string. */
export async function payerActivate(sessionId, mobile) {
  const st = await gatewayPayerActivate(sessionId, mobile);
  await http('POST', `${GW}/api/v1/checkout/${sessionId}/payment-done`, { label: 'gw-payer', body: {} });
  const payable = st?.payableAmount ?? st?.session?.payableAmount;
  note(`gateway session ${sessionId} status=${st?.status} payableAmount=${payable}`);
  return payable;
}

export async function simulatePaid(sessionId, payable, utr) {
  const r = await gatewaySimulatePaid(sessionId, payable, utr);
  note(`simulator inject -> ${r.status} pipeline=${r.json?.status}`);
  return r;
}

export async function waitObserved(orderId, timeoutMs = 60000) {
  return waitFor(() => {
    const s = sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${orderId}' order by "createdAt" desc limit 1`);
    return s === 'OBSERVED' ? s : null;
  }, { timeoutMs, what: `attempt OBSERVED for ${orderId}` });
}

export async function gatewayDeliveries(file) {
  const r = await gwAdmin('GET', '/api/v1/admin/webhooks/deliveries?limit=50');
  save(file, r.json ?? r.text);
  return r.json;
}
