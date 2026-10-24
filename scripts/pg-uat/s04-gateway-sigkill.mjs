// S4: gateway SIGKILL during the first webhook delivery; on restart the event is redelivered and
// processed exactly once.
//  Variant A (hold-request): delivery is in flight at the tap when the gateway dies; the app never
//    receives it. After restart the fork's dispatcher reclaims the expired lease and redelivers.
//  Variant B (hold-response): the app has committed the delivery, but the gateway dies before it
//    sees the 200. After restart it redelivers; the app answers 200 deduped.
import { note, save, scenario, snapOrder, sqlVal, waitFor, tapMode, tapFiles, tapRead, sleep, gwAdmin, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved } from './flow.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
const UAT = process.env.UAT_DIR;
scenario('s04-gateway-sigkill');

function killGateway() {
  const pid = fs.readFileSync(`${UAT}/gw-api.pid`, 'utf8').trim();
  execFileSync('kill', ['-9', pid]);
  note(`SIGKILL gateway payment-api pid ${pid} at ${new Date().toISOString()}`);
}
function startGateway() {
  const out = execFileSync('bash', [`${process.cwd()}/../../scripts/pg-uat/start-gateway.sh`], { encoding: 'utf8', env: process.env });
  note(`gateway restarted: ${out.trim()} at ${new Date().toISOString()}`);
}
const rows = (orderId) => sqlVal(`select count(*) from "PaymentWebhookEvent" where "orderId" in (select "attemptKey" from "PgPaymentAttempt" where "orderId"='${orderId}')`);
const ev = (orderId) => sqlVal(`select count(*) from "PgPaymentEvidence" e join "PgPaymentAttempt" a on a.id=e."attemptId" where a."orderId"='${orderId}' and e.source='GATEWAY_WEBHOOK'`);

async function variant(tag, phone, payer, item, utr, mode) {
  note(`---- variant ${tag} (${mode})`);
  const { orderId, sessionId } = await orderAndOpenCheckout(phone, item);
  const payable = await payerActivate(sessionId, payer);
  tapMode(mode);
  const before = tapFiles().length;
  await simulatePaid(sessionId, payable, utr);
  await waitFor(() => tapFiles().length > before, { what: 'delivery reached tap', timeoutMs: 15000 });
  await sleep(500);
  killGateway();
  await sleep(7000); // past the tap hold
  tapMode('pass');
  const r0 = rows(orderId), s0 = sqlVal(`select state from "PgPaymentAttempt" where "orderId"='${orderId}'`);
  note(`after kill, before restart: app webhook rows=${r0}, attempt=${s0}`);
  startGateway();
  const t0 = Date.now();
  await waitFor(() => tapFiles().length > before + 1, { what: 'redelivery after restart', timeoutMs: 120000, everyMs: 2000 });
  await waitObserved(orderId, 30000);
  await sleep(2000);
  note(`redelivery seen ${Math.round((Date.now() - t0) / 1000)}s after restart`);
  const r1 = rows(orderId), e1 = ev(orderId);
  const dl = await gwAdmin('GET', `/api/v1/admin/webhooks/deliveries?limit=50`);
  const mine = (dl.json?.data ?? []).filter((d) => d.resourceId === sessionId);
  save(`gateway-delivery-${tag}.json`, mine);
  // Transmissions of this event as seen on the wire (the fork's attemptCount does not count the killed attempt).
  const wid = tapRead(tapFiles()[before]).headers['webhook-id'];
  const sends = tapFiles().slice(before).filter((f) => tapRead(f).headers['webhook-id'] === wid).length;
  note(`EXPECT ${tag}: same webhook-id ${wid} transmitted ${sends}x (>=2), exactly one webhook row and one GATEWAY_WEBHOOK evidence (rows=${r1}, evidence=${e1}), gateway delivery SUCCEEDED (${mine.map((d) => `${d.status}/${d.attemptCount}`).join(',')}): ${ok(sends >= 2 && r1 === '1' && e1 === '1' && mine.some((d) => d.status === 'SUCCEEDED'))}`);
  snapOrder(`db-${tag}.txt`, orderId);
  return { orderId, sessionId, beforeRestartRows: r0 };
}

const A = await variant('A', '+910000000141', '9000000141', item('Sweet Lassi'), '610400000141', 'hold-request:5000');
note(`EXPECT A: app had nothing before restart: ${ok(A.beforeRestartRows === '0')}`);
const B = await variant('B', '+910000000142', '9000000142', item('Gulab Jamun (2 pc)'), '610400000142', 'hold-response:5000');
note(`EXPECT B: app had committed before the gateway died: ${ok(B.beforeRestartRows === '1')}`);
save('ids.json', { A, B });
