# Flavrly — Legal & Privacy Compliance

**Scope:** India (Digital Personal Data Protection Act, 2023 — "DPDP Act"). No EU/UK users at present, so GDPR is treated as "nice to have," but the mechanisms below are built to a GDPR-ready standard so expansion is painless.

> ⚠️ **Not legal advice.** This document maps your product to a compliance checklist and records where things live. Have a qualified Indian data-protection lawyer review your published policies before you rely on them, especially the retention periods and the named Grievance Officer.

_Last reviewed: 2026-07-05._

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
| Payments | Razorpay (when enabled) | Razorpay (India) | You store payment *metadata/status*, not full card data — card data lives with Razorpay. |
| Edge / CDN | Cloudflare in front of the VPS | Cloudflare | Caches static assets; proxies traffic. |
| Backups | `deploy/backup.sh` (pg_dump), optional off-host via rclone | Wherever rclone is pointed | Confirm where backups land — they contain all PII. |

**"Where is my data?" answer:** *In a PostgreSQL database on our own server hosted with Hostinger in India, plus uploaded images/videos on that same server (or an S3 bucket if configured). Payment processing is handled by Razorpay. We do not sell your data.*

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
