// S3 part B: replay of an OLD delivery (> 5 min after it was signed). The app only acknowledges a
// stale timestamp for a delivery id it already stored (200 deduped, nothing re-run); an unknown stale
// delivery is never stored.
import { note, scenario, sqlVal, replayCaptured } from './uat-lib.mjs';
import fs from 'node:fs';
const E = process.env.EVID || '/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s';
const first = JSON.parse(fs.readFileSync(`${E}/s03-duplicate-and-replay/ids.json`, 'utf8')).captured[0];
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s03-duplicate-and-replay');
const rows0 = sqlVal(`select count(*) from "PaymentWebhookEvent"`);
const ev0 = sqlVal(`select count(*) from "PgPaymentEvidence"`);
const r = await replayCaptured(first, 'stale identical bytes');
const rows1 = sqlVal(`select count(*) from "PaymentWebhookEvent"`);
const ev1 = sqlVal(`select count(*) from "PgPaymentEvidence"`);
note(`EXPECT stale replay of a known delivery -> 200 deduped, no new rows (webhook ${rows0}->${rows1}, evidence ${ev0}->${ev1}): ${ok(r.status === 200 && r.text.includes('deduped') && rows0 === rows1 && ev0 === ev1)}`);
