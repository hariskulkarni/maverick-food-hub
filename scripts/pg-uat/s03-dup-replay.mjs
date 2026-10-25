// S3: duplicate deliveries and replay of an old delivery are deduped.
//  a) gateway resends the same delivery (same webhook-id, freshly re-signed)       -> 200 deduped
//  b) gateway endpoint replay over a time range (same webhook-ids)                   -> 200 deduped
//  c) byte-for-byte replay of the captured request (attacker/proxy replay)           -> 200 deduped, nothing re-run
//  d) captured request with a forged webhook-id / tampered body                      -> 401
//  (stale replay > 5 min old: s03b, run later)
import { APP, http, note, save, scenario, snapOrder, sqlVal, gwAdmin, waitFor, replayCaptured, tapFiles, sleep, item } from './uat-lib.mjs';
import { orderAndOpenCheckout, payerActivate, simulatePaid, waitObserved } from './flow.mjs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s03-duplicate-and-replay');
const before = tapFiles().length;
const { orderId, sessionId } = await orderAndOpenCheckout('+910000000103', item('Garlic Naan')); // Garlic Naan
const payable = await payerActivate(sessionId, '9000000103');
await simulatePaid(sessionId, payable, '610300000103');
await waitObserved(orderId);
const cap = tapFiles().slice(before);
note(`captured deliveries through tap: ${cap.join(',')}`);
const attemptKey = sqlVal(`select "attemptKey" from "PgPaymentAttempt" where "orderId"='${orderId}'`);
const counts = () => sqlVal(`select (select count(*) from "PaymentWebhookEvent" where "orderId"='${attemptKey}')||'/'||(select count(*) from "PgPaymentEvidence" e join "PgPaymentAttempt" a on a.id=e."attemptId" where a."orderId"='${orderId}')`);
const c0 = counts();
note(`webhook rows / evidence rows after first delivery: ${c0}`);

const dl = await gwAdmin('GET', `/api/v1/admin/webhooks/deliveries?limit=20`);
const mine = (dl.json?.data ?? []).filter((d) => d.resourceId === sessionId);
save('ids.json', { orderId, sessionId, attemptKey, deliveries: mine.map((d) => d.id), captured: cap });
// a) resend
await gwAdmin('POST', `/api/v1/admin/webhooks/deliveries/${mine[0].id}/resend`);
await waitFor(() => tapFiles().length > before + cap.length, { what: 'resend through tap', timeoutMs: 20000 });
// b) endpoint replay of the last 10 minutes (also replays S1/S2 deliveries)
const since = new Date(Date.now() - 10 * 60e3).toISOString();
await gwAdmin('POST', `/api/v1/admin/webhooks/endpoints/we_884c25a26d40a23fe7c3a232/replay`, { since });
await sleep(5000);
// c) byte-for-byte replay of the captured first delivery
const r1 = await replayCaptured(cap[0], 'identical bytes');
// d) forged id / tampered body
const r2 = await replayCaptured(cap[0], 'forged webhook-id', (h) => { h['webhook-id'] = 'evt_forged_uat_0001'; h['x-gateway-delivery-id'] = 'evt_forged_uat_0001'; });
const r3 = await replayCaptured(cap[0], 'tampered body (utr changed)', (h, b) => Buffer.from(b.toString().replace('610300000103', '699999999999')));
const c1 = counts();
note(`webhook rows / evidence rows after all duplicates+replays: ${c1}`);
note(`EXPECT identical replay 200 deduped: ${ok(r1.status === 200 && r1.text.includes('deduped'))}`);
note(`EXPECT forged id and tampered body 401: ${ok(r2.status === 401 && r3.status === 401)}`);
note(`EXPECT no new webhook rows and no new evidence (${c0} == ${c1}): ${ok(c0 === c1)}`);
note(`EXPECT attempt still OBSERVED with original UTR: ${ok(sqlVal(`select state||'|'||"observedUtr" from "PgPaymentAttempt" where "orderId"='${orderId}'`) === 'OBSERVED|610300000103')}`);
const all = sqlVal(`select count(*)||'/'||count(distinct "providerEventId") from "PaymentWebhookEvent" where provider='youpi'`);
note(`all youpi webhook rows / distinct delivery ids: ${all}`);
snapOrder('db.txt', orderId);
