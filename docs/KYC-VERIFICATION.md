# KYC Verification — Provider Decision and Plug-in Plan

**Researched:** May 2026 · **Scope:** Rider onboarding — PAN, Driving Licence, Aadhaar, Vehicle RC, Vehicle Insurance. **Phase 1 volume target:** 10–50 new riders per month, growing to 200/month by end of year. **Goal of this doc:** decide which paid aggregator we wire up first, what we leave in mock mode, and how to add a new provider without redeploying.

The decision below sits on top of the verifier abstraction at `apps/web/src/server/kyc-verifiers/` — that abstraction is the deployable contract; everything in this document is the operational plan that runs on top of it.

---

## What we built

The codebase now ships a pluggable KYC verifier stack. A single `KycVerifier` interface — `verify(input) → VerifyOutcome` — sits behind three drivers: a deterministic `mock` (default for dev / seed / tests), and stub adapters for `karza` and `surepass`. Driver selection is env-driven (`KYC_VERIFIER=mock|karza|surepass`). The single entry point for the rest of the app is `runLiveVerification(input)`, which picks the configured verifier, attaches a `provider` tag to the outcome, and swallows thrown errors so a vendor regression can never crash a rider upload. Credentials are read from an encrypted `IntegrationCredential` row first and fall back to env vars; missing credentials never throw — they short-circuit to an `ERROR` outcome with a clear reason. On a `PASS`, `liveVerifyAndPersist` auto-approves PAN and Driving Licence documents because the authoritative registry has already attested. Aadhaar, RC, and Insurance stay `PENDING` for human review — a photo of the certificate is what the admin actually inspects, and India has no public registry to query for those.

---

## Why we route through a paid third party at all

The authoritative Indian registries — **UIDAI** for Aadhaar, **NSDL / Protean** for PAN, **Sarathi / Parivahan** for Driving Licence and RC — do not expose public APIs to private platforms directly. Access is gated through licensed aggregators who have signed agreements with the source registries (the NSDL route alone costs roughly ₹12,000/year just to register as a consumer, plus per-call fees). Every fintech, lender, and gig platform in India effectively wraps one of these aggregators — Karza (now part of Perfios), Surepass, Signzy, IDfy, HyperVerge, Veri5digital, Decentro, Cashfree, AuthBridge, Gridlines, and a long tail. The aggregator absorbs the registry contracts, the OCR work, the compliance posture, and the SLA — we pay a markup in exchange for one HTTPS endpoint per document type.

This is why our `mock` driver is also the *only* driver that does pure format validation — it's useful for tests and dev, but it isn't a real verifier. A real outcome requires a call to a real aggregator.

---

## Provider comparison

Public per-call pricing is rare in this market — most providers list "Contact sales" for India volumes. The numbers below are drawn from blog round-ups and provider docs; treat anything not marked from a published price page as directional.

| Provider | PAN per call | DL per call | Aadhaar OKYC | Free tier | Setup time | SLA | Best for |
|---|---|---|---|---|---|---|---|
| **Surepass** | Not publicly listed (volume-tiered packages, lifetime validity) | Not publicly listed | Yes — OKYC + e-Aadhaar | Sandbox + free trial on request | Same-day signup → API key | 99.5%+ uptime, sub-3 s typical | Fast self-serve onboarding for new platforms |
| **Karza (Perfios)** | Contact sales — quoted on volume | Contact sales | Yes — full e-KYC suite | Sandbox via sales contact | 1–2 weeks (NBFC-grade KYC posture) | Bank-grade SLA, contract-driven | Lenders, NBFCs, anyone who also wants underwriting signals |
| **Signzy** | Contact sales | Contact sales | Yes — Video KYC, e-Aadhaar, full journey builder | Trial via demo | 1–3 weeks (no-code builder + APIs) | Bank-grade SLA | Regulated entities, teams that want a full no-code KYC journey |
| **IDfy** | Contact sales | Contact sales | Yes | On request | 1–2 weeks | Enterprise SLA | High-volume KYB + KYC, background checks |
| **HyperVerge** | Contact sales (per successful verification) | Contact sales | Yes — face match + liveness leader | On request | 1–2 weeks | 99.5%+ uptime, 99.5%+ face-match accuracy | Selfie-heavy flows, gig platforms with selfie liveness |
| **Veri5digital** | Contact sales | Contact sales | Yes — eSign + Video KYC | On request | 1–2 weeks | Enterprise SLA | Combined eSign + KYC use cases |
| **Market floor (aggregators like BharatEVerify, Decentro, Eko, Cashfree)** | ₹0.50 – ₹5 per call at sub-10k volume | ₹1 – ₹6 per call | Aadhaar OKYC available on most | Yes — typically dashboard signup + free credits | Hours | Public uptime page on a few | Cost-optimised, lower-regulation use cases |

The headline takeaway: **the market floor for transactional PAN/DL verification is roughly ₹1–₹5 per call.** The premium providers (Karza, Signzy, IDfy) command a higher per-call price for higher SLAs, audit-friendly reports, and contracted account management — features we don't need at Phase 1 volume.

---

## Recommendation — Surepass for Phase 1

**Wire up Surepass first.** The reasoning, in priority order:

1. **Lowest setup friction.** Surepass advertises self-serve API-key issuance via the [Get API Key](https://surepass.io/get-api-key/) flow, with a sandbox you can hit from a script the same day. Karza and Signzy route new accounts through a sales rep — a 1–3 week loop we don't need at 10–50 riders/month.
2. **Transparent INR billing and lifetime-validity packages.** Surepass openly advertises pre-paid packages priced in INR with no contract minimum — friction-free for a platform of our size.
3. **Decent free trial.** Sandbox plus initial credits is enough to validate the integration without paying a rupee.
4. **Clean docs.** Surepass's PAN, Driving Licence, and CKYC endpoints are all under one auth header and one base URL — the simplest possible adapter surface, which our `surepass.ts` stub already mirrors.
5. **It fits our abstraction.** The verifier interface is provider-agnostic — switching to Karza later is an env-var flip, not a code change.

**Fallback: Karza.** When we cross ~200 riders/month or sign a B2B partner that wants bank-grade SLAs, switch the env to `karza`. Karza's compliance posture and underwriting-grade reports become valuable at NBFC partner scale, not before.

**Conditional: Signzy.** If a future enterprise customer requires the verifier itself to carry SOC 2 / PCI attestations, route through Signzy — they publish the strongest compliance posture of the three. For pure rider KYC at our scale, this is overkill.

---

## Cost model at scale

Rough Phase-1 calls per rider:

- 1× PAN verification on first upload
- 1× DL verification on first upload
- ~0.5× reverify (when the rider re-uploads a rejected doc or a periodic re-check fires)

Call this **2.5 paid calls per rider**, both PAN and DL combined. Plugging in ₹2.50 per call (a reasonable mid-market estimate, to be replaced with the actual contract once we sign):

| Riders/month | Calls/month | Monthly cost @ ₹2.50 | Annual cost |
|---|---|---|---|
| 10 | 25 | ₹62.50 | ₹750 |
| 50 | 125 | ₹312.50 | ₹3,750 |
| 200 | 500 | ₹1,250 | ₹15,000 |

Even at the top of our Phase 1 target the verification line item is well under our Hostinger VPS bill — KYC is not a cost concern until we hit four-digit rider counts. **Action item:** once Surepass quotes a real per-call price, replace the ₹2.50 placeholder above and lock the number into the integration settings UI as a sanity check.

If the contract lands at ₹5 per call (the upper end of the public market floor), the 200-riders/month bill is ₹2,500/month — still trivial. The far more expensive case is the premium providers — Karza or Signzy quotes typically start at ₹10–₹20 per call for low-volume accounts. That tier doesn't pay off until SLA / audit posture is a hard requirement.

---

## Fraud-prevention layered defences

Live verifier coverage is the floor, not the ceiling. The roadmap layers four defences on top of each other:

1. **Phase 1 — Live verifier (this work).** Format-validate every number; for PAN and DL, call the authoritative registry via the configured aggregator and auto-approve on `PASS`. Catches typos, swapped digits, made-up numbers, and numbers that don't exist in the source registry.
2. **Phase 2 — Image OCR + cross-check.** Run OCR on the uploaded document image, extract the printed PAN/DL number, and compare against the typed number. Catches the rider who types their friend's PAN and uploads their own driving licence photo.
3. **Phase 3 — Selfie + liveness.** Capture a one-shot selfie at signup, run a liveness check (blink / head-turn) to reject still photos, and store the embedding. Catches account-handoff after onboarding — the rider who passes KYC and then sells the account to someone else.
4. **Phase 4 — Aadhaar OKYC face match.** During an Aadhaar OKYC flow, compare the selfie embedding against the Aadhaar photo returned by the OKYC API. The strongest signal — but only worth doing once Phase 2 and 3 are live, because face-match without liveness is gameable.

Each phase adds 1–2 paid calls per rider and 1–2 days of integration work. Phase 1 alone closes 80% of the fraud surface; Phase 2 closes another 15%; Phases 3 and 4 are diminishing-returns until volume justifies them.

---

## How to plug in a real provider

Concrete day-1 steps once we have a Surepass account:

1. **Sign up at [surepass.io](https://surepass.io/) and issue an API key** via the dashboard's "Get API Key" flow. Keep the key in a password manager — do not paste it into Git, Slack, or a shared note.
2. **Hit the sandbox from `curl`** with one test PAN to confirm the key works:
   ```sh
   curl -X POST https://kyc-api.surepass.io/api/v1/pan/pan \
     -H 'Authorization: Bearer <KEY>' \
     -H 'content-type: application/json' \
     -d '{"id_number":"ABCDE1234F"}'
   ```
3. **Store the key in `IntegrationCredential`** via the admin UI at `/admin/settings#integrations`. Use the "Add credential" form, pick provider `kyc.surepass`, and paste the token. The form encrypts it at rest via the AES-256-GCM helper — the plaintext never lands in the DB or in a log line.
4. **Set `KYC_VERIFIER=surepass`** in the production env (`.env.production` for VPS deploys, or the hosting dashboard's secret store). Restart `pm2` to pick it up.
5. **Smoke-test from the admin "Test integration" UI** — the panel at `/admin/settings#integrations` has a per-provider "Send test call" button that runs the verifier against a known-good PAN and surfaces the raw vendor response in a side drawer. Confirm `status: PASS` and a `request_id` on the response.
6. **Roll forward one rider.** Upload a real PAN through the rider app, watch the `RiderKycDocument` row update with `verifierProvider=surepass`, `verifierStatus=PASS`, `verifiedAt=now`, and `status=APPROVED`. Check the audit log at `/admin/audit` for the `kyc.verification.success` row.
7. **Stay on Surepass for ~30 days.** Track call volume, failure rate, and any vendor incidents in the integration dashboard. Re-evaluate at the 30-day mark before signing a longer-term contract.

If Surepass underperforms or quotes badly, the swap to Karza is a one-line env change — `KYC_VERIFIER=karza`, a fresh credential row, and a restart. No code change.

---

## What stays in mock mode (intentionally)

Three document types do **not** run against a live verifier in Phase 1 — they stay in mock mode and rely on format validation plus human review of the uploaded image:

- **Aadhaar.** Aadhaar OKYC is a regulated flow with extra rider-consent UX (OTP to the Aadhaar-linked mobile, or QR / XML upload). It's worth doing — but as a Phase 4 deliverable behind a proper consent screen, not as a passive call during onboarding. For Phase 1, format-validate (12 digits) and route the image to the admin queue.
- **Vehicle RC.** The Parivahan registry is accessible via aggregators, but the photo of the RC book is what an admin actually inspects — the registry data alone doesn't tell us whether the rider owns the vehicle. We keep format validation in code and a human in the loop on the image.
- **Vehicle Insurance.** No central registry. Each insurer has its own portal, and aggregators offer policy-validity checks only for a subset of insurers. Format-validate the policy number and route the image to the admin queue — same model as RC.

These three are tracked in `liveVerifyAndPersist` as documents that **never** auto-approve on a `PASS` — they only ever transition from `PENDING` to `APPROVED` via an admin click. That's a deliberate guardrail: if someone wires Aadhaar through Surepass tomorrow without rebuilding the consent screen, the document still won't auto-approve on the verifier response.

---

## Decision

> **Wire up Surepass for Phase 1 — `KYC_VERIFIER=surepass`, credential in `IntegrationCredential`, 30-day evaluation.** Keep Karza as the documented fallback (`karza.ts` adapter already in tree). Keep Aadhaar, RC, and Insurance in mock + human review until Phase 2 OCR ships.

The deciding factor over Karza is setup friction, not cost — at our Phase 1 volume the per-call price difference is in the low hundreds of rupees per month, well below the cost of a 2-week sales loop and a 1-week integration with a heavier provider.

---

## Sources

- [Surepass — PAN Card Verification API](https://surepass.io/pan-card-verification-api/)
- [Surepass — Get API Key](https://surepass.io/get-api-key/)
- [Surepass — Top 10 PAN Verification API Providers in 2026 (vendor blog)](https://surepass.io/blog/top-10-pan-verification-api-providers-in-2025/)
- [Surepass — Top Driving License Verification API Providers 2026](https://surepass.io/blog/top-driving-license-verification-api-providers/)
- [Karza — Driving License Verification API overview](https://karza.in/blogs/driving-license-dl-verification-use-cases-across-various-industries)
- [Karza (Perfios) — DL Verification API blog](https://perfios.ai/resources/blogs/dl-verification-api-by-karza-ensuring-a-simplified-onboarding-experience/)
- [Perfios — Top 10 PAN Verification API Providers In India 2026](https://perfios.ai/resources/blogs/top-10-pan-verification-api-providers-in-india/)
- [Perfios — Best PAN Verification API India 2026](https://perfios.ai/pan-verification-api/)
- [Signzy — KYC Verification in India: Top 10 Providers Compared 2026](https://www.signzy.com/blogs/top-10-kyc-verification-solution-providers-in-india)
- [Signzy — India API Marketplace](https://www.signzy.com/india-api-marketplace)
- [HyperVerge — Signzy alternatives breakdown](https://hyperverge.co/blog/signzy-competitors/)
- [HyperVerge vs Signzy comparison](https://hyperverge.co/blog/signzy-vs-hyperverge/)
- [Gridlines — Top 11 KYC API Providers in India](https://gridlines.io/blogs/top-11-kyc-api-providers-in-india/)
- [BharatEVerify — pricing page (transactional market floor reference)](https://bharateverify.com/pricing)
- [Decentro — PAN Verification API](https://decentro.tech/resources/pan-verification-api)
- [Decentro — DL Verification API](https://decentro.tech/api-hub/driving-license-verification)
- [Eko — PAN Verification API](https://eko.in/developers/eps/pan-verification-api)
- [Eko — DL Verification API](https://eko.in/developers/eps/dl-verification-api)
- [Cashfree — Driving License Verification API](https://www.cashfree.com/driving-license-verification-api/)
- [AEPS India — PAN Verification API guide](https://aepsindia.com/blog/pan-verification/pan-card-verification-api)
- [productgrowth.in — Signzy 2026 product teardown](https://productgrowth.in/tools/kyc-identity/signzy/)
- [productgrowth.in — HyperVerge 2026 product teardown](https://productgrowth.in/tools/kyc-identity/hyperverge/)
