# Flavrly — Legal & Privacy Compliance

**Scope:** India (Digital Personal Data Protection Act, 2023 — "DPDP Act"). No EU/UK users at present, so GDPR is treated as "nice to have," but the mechanisms below are built to a GDPR-ready standard so expansion is painless.

> ⚠️ **Not legal advice.** This document maps your product to a compliance checklist and records where things live. Have a qualified Indian data-protection lawyer review your published policies before you rely on them, especially the retention periods and the named Grievance Officer.

_Last reviewed: 2026-10-22._

---

## Status at a glance

| # | Checklist item | Status | Where |
|---|----------------|--------|-------|
| 1 | Privacy policy | ✅ Done | `/privacy` page (DPDP-aligned) |
| 2 | Know where user data is stored | ✅ Documented | This doc → *Data storage map* |
| 3 | GDPR / data-law obligations | 🟡 Improved | Cookie consent + self-serve deletion **added**; see gaps |
| 4 | Don't collect data you don't need | ✅ Good | This doc → *Data minimization audit* |
| 5 | Terms of service | ✅ Done | `/terms` page |

Also live already: `/cookies` (Cookie Policy), `/refunds` (Refund & Cancellation).

---

## 1. Privacy policy — ✅ already live

The `/privacy` page exists with real, Flavrly-specific content and references India's DPDP Act. It describes account data, order data, location data, and how data is shared with restaurants/riders.

**Keep it honest — action items:**
- Ensure every category listed matches what the app actually collects (see the data inventory below). If you add analytics or a new field, update this page the same day.
- Name a **Grievance Officer** (DPDP Act requirement) with a contact email on the page.
- State a concrete **retention period** for each data type (e.g. "order records kept 8 years for tax; account data deleted on request").

## 2. Where user data is stored — data storage map

| Data | Store | Provider / location | Notes |
|------|-------|---------------------|-------|
| All app data (users, orders, addresses, restaurants, payments metadata) | **PostgreSQL** | Self-hosted on your **Hostinger VPS** (`148.230.66.124`), single instance, region: India | Set via `DATABASE_URL`. This is the system of record. |
| Uploaded media (menu images, logos, hero **videos**) | Local disk `public/uploads/` **or** S3 | `STORAGE_DRIVER=local` (VPS disk) or `s3` (`S3_REGION`) | Currently local on the VPS unless S3 is configured. |
| Sessions / auth | PostgreSQL (`UserSession`) + signed cookies | Same VPS | One active device per user; sessions revocable. |
| Payments | Razorpay (where enabled) | Razorpay (India) | You store payment *metadata/status*, not full card data — card data lives with Razorpay. |
| Direct UPI payment confirmation | **Flavrly PG** (self-hosted) | Same India VPS as the app | Customer pays straight to Flavrly's/the restaurant's own UPI ID (QR or app intent). Flavrly PG matches the bank credit alert observed on the **merchant's own devices** (phone / bank-alert mailbox) to the order by amount, UTR and time. It never touches the customer's phone or messages. Stores: payment status/reference, optional customer-entered UTR, payer UPI ID/name **masked**. Retention: redacted raw alert text 30 days; matched records as required by law (tax/accounting); unmatched records 90 days. |
| Edge / CDN | Cloudflare in front of the VPS | Cloudflare | Caches static assets; proxies traffic. |
| Backups | `deploy/backup.sh` (pg_dump), optional off-host via rclone | Wherever rclone is pointed | Confirm where backups land — they contain all PII. |

**"Where is my data?" answer:** *In a PostgreSQL database on our own server hosted with Hostinger in India, plus uploaded images/videos on that same server (or an S3 bucket if configured). UPI payments go directly to our (or the restaurant's) UPI ID and are confirmed by our self-hosted software on the same server; card/other online payments are handled by Razorpay where enabled. We do not sell your data.*

**Action items:** confirm the backup destination (it holds full PII — it must be access-controlled and, ideally, encrypted); document a DB + uploads retention/backup-rotation policy.

## 3. GDPR / data-law obligations — what was added

For India (DPDP Act) the key duties are: **consent**, **the right to correction & erasure**, a **Grievance Officer**, and **purpose limitation**. Two mechanisms were missing and are now built:

- **Cookie consent banner** — `src/components/cookie-consent.tsx`, mounted in the customer layout. Records "Accept all" vs "Essential only" in a 1-year cookie + localStorage. Today the app sets **only strictly-necessary cookies** and loads **no third-party analytics**, so this is consent-capture; gate any future analytics on `hasAnalyticsConsent()`.
- **Self-serve account & data deletion** ("right to erasure") — button under **Profile → Security & sessions**. Calls `POST /api/customer/delete-account`, which anonymises the user's PII (name, email, phone, avatar), deletes saved addresses, and revokes all sessions. Past orders are retained in **anonymised** form for legal/tax records (a legitimate DPDP purpose).

**Remaining gaps / recommended next:**
- **Data correction:** users can edit profile/addresses today (good). Make sure that's discoverable.
- **Data export ("portability"):** not built. Optional under DPDP; add a "Download my data" (JSON) endpoint if you want to be thorough.
- **Grievance Officer** name + contact on `/privacy` and `/contact`.
- **Consent records:** the banner stores the choice client-side; if you later run analytics, log server-side consent too.

## 4. Data minimization audit — ✅ in good shape

What the app collects, and the verdict:

| Field | Collected? | Needed? | Verdict |
|-------|-----------|---------|---------|
| Name | Yes | Delivery + support | ✅ keep |
| Phone | Yes (OTP login) | Login + rider contact | ✅ keep |
| Email | Optional | Receipts/notices | ✅ keep (optional is good) |
| Password | Only ADMIN/KITCHEN (hashed) | Staff login | ✅ hashed with argon2 |
| Delivery address | Yes | Delivery | ✅ keep |
| Device location | Only with permission | Live tracking | ✅ consent-based |
| Order history | Yes | Fulfilment + tax | ✅ keep |
| Third-party analytics | **No** | — | ✅ nothing to minimize |

**Verdict:** you are **not** over-collecting. The main lever is *retention*, not collection — decide how long to keep order/address history and enforce it. Don't add analytics/marketing fields without a clear purpose and a consent gate.

## 5. Terms of service — ✅ already live

`/terms` exists with real content: marketplace model, eligibility (18+), accounts, orders/payments, liability limits. **Action item:** confirm the governing-law/jurisdiction clause names your city/state, and that the limitation-of-liability wording has been lawyer-reviewed.

---

## 6. Flavrly PG (self-hosted UPI) — 2026-10-22 policy update

> **Not legal advice — have counsel review.** The wording below was written to describe the product accurately; a qualified Indian lawyer should confirm it against the DPDP Act 2023, DPDP Rules 2025, RBI/NPCI UPI rules and consumer-protection law before relying on it.

Published pages updated (`/privacy`, `/terms`, `/refunds`; "Last updated: 22 October 2026"):
- **Privacy:** checkout data (mobile, name, email for WhatsApp OTP sign-in; optional UTR; payment status/reference; masked payer UPI ID/name from bank alerts); new section on how Flavrly PG confirms UPI payments and that it does not access the customer's phone/SMS/messages; retention (30 days / as required by law / 90 days); storage in India; DPDP Act + DPDP Rules rights incl. nomination and escalation to the Data Protection Board of India. Grievance Officer contact unchanged.
- **Terms:** direct-UPI payment method, Razorpay "where enabled", screenshots not proof of payment, wrong-amount / expired-window payments recorded and reconciled, risk-check holds, no PIN requests or collect requests, UPI disputes via NPCI UDIR.
- **Refunds:** direct-UPI refunds go back to the payer's UPI ID / source account within the existing 5–7 business day language; new section on wrong amounts, late payments and UPI disputes.
- `/cookies` checked — no change needed (third-party "payment processing" cookies remain accurate where Razorpay is enabled). `/contact` does not list the Grievance Officer, so it was not changed (still an open to-do below).

Open points for counsel: whether a named Grievance Officer (not only a mailbox) is required on `/privacy`; the exact statutory retention period to cite for matched payment records; whether payer UPI ID/name masking and the 30/90-day windows are enforced in code as stated.

## What changed in this pass (code)

- `src/components/cookie-consent.tsx` — new consent banner (+ `hasAnalyticsConsent()` helper).
- `src/app/(customer)/layout.tsx` — mounts the banner site-wide.
- `src/app/api/customer/delete-account/route.ts` — new erasure endpoint (anonymise + delete addresses + revoke sessions).
- `src/app/(customer)/profile/security/delete-account.tsx` — danger-zone UI with typed confirmation.
- `src/app/(customer)/profile/security/page.tsx` — mounts the delete UI.

## Prioritized to-do (not code — your calls)

1. Add a named **Grievance Officer** + contact to `/privacy` and `/contact`.
2. State concrete **retention periods** on `/privacy`.
3. Confirm & secure the **backup destination** (it holds all PII).
4. Lawyer review of `/privacy` and `/terms` before launch.
5. (Optional) "Download my data" export endpoint for full portability.
