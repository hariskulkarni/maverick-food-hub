# Flavrly PG: compliance and licence blockers

Status as of 2026-10-24 (Agent G). **Production real-money activation: BLOCKED.**

> **Not legal advice.** This is an engineering list of the approvals and documents that must exist
> before Flavrly PG takes real customer money. It does not interpret law for Flavrly. Every gate
> below needs a human owner and, where marked, qualified Indian counsel. **No approval, licence,
> certification or bank sign-off exists today.** Nothing in this repository proves one.
> Engineering completion does not clear any gate here (master prompt §0, §18, §24, §25).

Legend:
- **BLOCKED**: required before any real-money pilot; currently missing.
- **OPEN**: required before general rollout or a stated deadline; work can continue meanwhile.
- **UNVERIFIED**: I could not confirm the rule from a primary source in this session. Counsel must confirm it.

## 1. What Flavrly PG actually is (facts the approvals hinge on)

- The customer pays **directly into the restaurant's own bank account / VPA** over UPI. A self-hosted
  YouPI-PG fork (`flavrly/pg-hardening` @ 7720b49, deployed per `DEPLOY-pg-hardening.md`; not
  independently verified) watches for the credit. It uses an Android observer app (bank/UPI-business-app
  notifications and SMS) and Gmail bank alerts. Flavrly then reconciles against bank evidence
  (contract D3/D4).
- **Flavrly does not receive, hold or settle the funds** (contract D14: `DIRECT_TO_MERCHANT`; no
  "payout completed" by Flavrly). There is **no acquiring bank, no payment aggregator and no
  merchant agreement** anywhere in this flow. A "SUCCESS" from the gateway means only "an observer
  saw an alert", not acquirer confirmation (D2).
- So this is **not** an acquirer/PA arrangement. Whether the restaurant's receiving account is
  enabled and permitted for merchant (P2M) collections depends on that restaurant's bank. Flavrly
  cannot grant or assume it.

## 2. Gates

### G-BANK: acquiring bank / receiving-bank permission (upstream #70)

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-BANK-1 | Each pilot restaurant's receiving account is a **current/merchant account permitted by its bank to receive business UPI collections** at the expected volume. Not a personal savings account used P2P. | Written confirmation from the restaurant's bank (or the restaurant's merchant/QR agreement with the bank), kept per `PgReceivingAccount`. | BLOCKED | Owner (human) + each restaurant |
| G-BANK-2 | Freeze/hold risk (#70): high-volume, many-payer credits into an account can trigger bank risk controls. Rate limits do **not** mitigate this (master prompt §4). | Bank's written thresholds/conditions, or acceptance that the account is a merchant account. Documented per account. | BLOCKED | Owner (human) |
| G-BANK-3 | Decide whether Flavrly should instead route through a licensed PA or acquiring bank's UPI merchant product. That would give real P2M merchant IDs, acquirer status APIs and refunds. | Written decision record, with a bank/PA term sheet if chosen. | OPEN | Owner (human) |
| G-BANK-4 | Authorised bank-statement / transaction-data source for reconciliation (#48, D4). No authorised live feed exists today. | Bank agreement or documented CSV statement process per account. | BLOCKED (automatic feed) / OPEN (CSV) | Owner (human) + restaurant |

### G-NPCI: UPI P2M vs P2P categorisation

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-NPCI-1 | Collections for food orders are merchant payments. Confirm with the receiving bank that they are categorised as P2M (or P2PM for eligible small merchants), not P2P. Also confirm that MDR/limits are understood. | Bank confirmation (see G-BANK-1). | BLOCKED | Owner (human) |
| G-NPCI-2 | Flavrly must not describe itself as an NPCI-certified gateway, PSP or TPAP. It is none of these. Copy review of checkout/marketing pages. | Screenshot/review sign-off. | OPEN | Owner (human) |

**UNVERIFIED (search-result snippet only, primary PDF not retrievable):** an NPCI FAQ on MDR for select
UPI P2M transactions (listed as updated 15 Oct 2026) reportedly does three things. It describes a
"P2PM" category for small vendors receiving into personal accounts with a monthly cap. It introduces
MDR on some P2M transactions above ₹2,000. It says implementation follows Diwali. The URL is
`npci.org.in/uploads/FA_Qs_Merchant_Discount_Rate_MDR_on_Select_UPI_P2_M_Transactions_58dba1d39e.pdf`;
the fetch failed with a redirect loop. Counsel or the bank must confirm the current figures and
whether the restaurants qualify.

### G-RBI: Payment Aggregator directions

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-RBI-1 | Written legal opinion that Flavrly's model (no handling of funds, direct-to-restaurant bank) is **outside** the PA authorisation requirement. It must also cover whether any future change crosses the line: collecting into a Flavrly account, netting commission, or a Flavrly payout. | Counsel memo. | BLOCKED | Owner (human) + counsel |
| G-RBI-2 | Architecture guard: Flavrly must never collect into a Flavrly-owned account or settle onward without PA authorisation or a licensed partner. Contract D14 already encodes this. | Code + contract review at each release. | OPEN | Lead (engineering) + Owner |

Source (fetched): RBI, *Reserve Bank of India (Regulation of Payment Aggregators) Directions, 2025*
(RBI/DPSS/2025-26/141, 15 Sep 2025), https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896:
- ¶4(i) defines a PA as an entity that "facilitates aggregation of payments made by customers to the merchants" and settles them.
- ¶4(j) and ¶10(g) say a Payment Gateway that only provides technology "without any involvement in handling of funds" is outside the MD's scope.
- ¶5(b) requires non-bank PAs to seek authorisation.
- ¶16(a) requires a non-bank PA to keep merchant funds in an escrow account.

Whether a notification-observer reconciliation service fits the ¶4(j) "PG" description is a
legal question, so it stays in G-RBI-1.

### G-KYC: merchant identity and bank-account ownership

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-KYC-1 | Proof that the receiving bank account/VPA belongs to the onboarded restaurant's legal entity (D7 `PgReceivingAccount` VERIFIED is a software state, not KYC). | Cancelled cheque / bank letter / penny-drop result naming the entity; reviewer identity and date recorded. | BLOCKED | Owner (human) / ops |
| G-KYC-2 | Restaurant entity KYC (PAN/GST/FSSAI as applicable) on file; see `docs/KYC-VERIFICATION.md`. | KYC record per restaurant. | OPEN | Ops (human) |
| G-KYC-3 | Per-restaurant gateway merchant credentials. Upstream and the fork only seed **one default merchant** (`packages/db/src/migrate.js:126` @ d7b0741, `:127` @ 7720b49), and there is no merchant-creation route (#89). Until per-restaurant merchant IDs exist, only **one** restaurant may be bound to the shared credential (D7). | Upstream/fork change, or a documented single-restaurant pilot. | BLOCKED (multi-restaurant) | Owner (human) + Lead |

### G-LIC: upstream YouPI-PG licence (upstream #56/#58)

Verified facts (local read-only checkout):
- `package.json` @ upstream main d7b0741 declares `"license": "Commercial"`, `"author": "Antigravity Systems"`.
  Same in fork 7720b49 (only `name` changed to `flavrly-pg`).
- **No LICENSE/NOTICE/COPYING file** exists in the tree at d7b0741 or at 7720b49 (`git ls-tree -r`).
- `README.md:595-597` @ d7b0741 says "See `LICENSE` for the actual license terms" (the file is absent) and that a
  licence "does not imply regulatory approval, bank approval, security certification, or permission to
  operate a regulated payment service".
- Issues #56 and #58 (licence clarification for commercial self-hosted use) are **OPEN with no maintainer
  answer** (`gh issue view`, 2026-10-24).
- The fork has **rebranded YouPI PG to Flavrly PG across 197 files** (commit ec8b986, 2026-10-21), and
  this rebranded fork is deployed (per deploy record). It is a modified, rebranded derivative of code with
  no granted licence.

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-LIC-1 | Written licence from the copyright holder(s) covering: commercial self-hosted use, SaaS use for third-party restaurants, modification, rebranding (removal of YouPI marks), private fork maintenance, distribution of the checkout SDK and observer APK. Also who holds copyright, and whether all contributors' code is covered. | Signed licence / written grant from the copyright holder(s). | BLOCKED | Owner (human) + counsel |
| G-LIC-2 | Until G-LIC-1 is resolved, record the legal risk of the already-deployed rebranded fork. Decide whether to keep it running for research only. | Owner decision record. | BLOCKED | Owner (human) |
| G-LIC-3 | Container images (#82): GHCR package still private (anonymous pull token denied, 2026-10-24). Flavrly deploys from a git bundle, so it is not affected. Any future image must be built internally from a reviewed pinned SHA with digest/SBOM. | Build record. | OPEN | Lead (engineering) |

### G-APK: observer APK redistribution and Android policy

Facts:
- The fork serves a **rebuilt, rebranded, Flavrly-signed APK** (`com.flavrly.observer` 1.1.1). It is
  served from `apps/payment-api/public/flavrly-sms-gateway.apk` (route `pollers.routes.js:768-772` @
  7720b49) and `apps/merchant-admin/public/`. Merchants sideload it.
- The manifest requests `RECEIVE_SMS`, `BIND_NOTIFICATION_LISTENER_SERVICE`, exact alarms, battery-optimisation exemption and camera.

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-APK-1 | Right to distribute a modified upstream binary to third parties (restaurants). Covered by G-LIC-1. | Licence clause. | BLOCKED | Owner (human) + counsel |
| G-APK-2 | If distributed via Google Play, Play's SMS/Call-Log and notification-listener policies apply (permission declaration, core-functionality justification). Sideloading avoids Play review but not the user-disclosure duties. **UNVERIFIED** (Play policy text not fetched this session). | Policy review if Play distribution is chosen. | OPEN | Owner (human) |
| G-APK-3 | Merchant-phone disclosure and consent: the app reads bank SMS/notifications on a phone the restaurant owns. This may include its staff's or owner's personal data. | Written merchant acceptance of the in-app disclosure, kept per device pairing. | OPEN | Ops (human) |
| G-APK-4 | Release keystore custody (`data/.secrets/android-release.keystore` on the fork host): backup, access list, rotation plan. | Custody record (do not commit). | OPEN | Owner (human) |

### G-DPDP: Digital Personal Data Protection Act 2023 and Rules 2025

Source (fetched): DPDP Rules, 2025, G.S.R. 846(E), MeitY notification dated **13 Nov 2025**,
https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf. Commencement under Rule 1:
- Rules 1, 2 and 17–21 commenced on publication.
- Rule 4 (consent managers) commences 1 year after publication, i.e. about 13 Nov 2026.
- Rules 3 and 5–16 (notice, security safeguards, breach intimation, erasure and the rest) and Rules 22–23 commence **18 months after publication, i.e. about 13 May 2027**.

The day count is my arithmetic from the gazette date; counsel must confirm the exact day. Secondary sources cite 13 or 14 May 2027.

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-DPDP-1 | Notice to customers covering the payment-data processing: UPI handle/VPA, payer name, UTR, amount, bank alert text, and observer evidence (Rule 3). | Updated `/privacy` + checkout notice. | OPEN (hard deadline ~May 2027; do before pilot) | Owner (human) + counsel |
| G-DPDP-2 | Purpose limitation: payment evidence is used for reconciliation, refunds and disputes only. It is not used for marketing or profiling. | Data-flow sign-off. | OPEN | Owner + Lead |
| G-DPDP-3 | Reasonable security safeguards (Rule 6): encryption, access control, access logs, and backups. Rule 6(1)(e) requires **retaining logs and personal data for 1 year** for incident investigation unless other law requires otherwise. | Retention config + SECURITY_THREAT_MODEL controls. | OPEN | Lead (engineering) |
| G-DPDP-4 | Breach intimation (Rule 7): to each affected Data Principal "without delay". To the Data Protection Board "without delay", with detailed information **within 72 hours**. | Incident runbook (OPERATIONS_RUNBOOK) with named contact. | OPEN | Owner (human) |
| G-DPDP-5 | Retention/erasure schedule for raw bank-alert text and payment evidence. The fork already purges raw text after `OBSERVATION_RAW_RETENTION_DAYS=30`, per the deploy record. Reconcile this with the 1-year log rule and any financial record-keeping law. | Counsel-approved retention table. | OPEN | Owner + counsel |
| G-DPDP-6 | Processor contracts: restaurants act as fiduciaries for their own customers, and Flavrly as processor and/or fiduciary depending on the flow. The fork host is Flavrly-operated. | Data processing terms in the restaurant agreement. | OPEN | Owner + counsel |
| G-DPDP-7 | Named Grievance Officer / contact. Still listed as TODO in `docs/legal-privacy-compliance.md:31`. | Published contact. | OPEN | Owner (human) |

Significant Data Fiduciary designation is not expected at Flavrly's scale. That is my assessment, **UNVERIFIED**: designation is by government notification.

### G-MKT: marketing consent

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-MKT-1 | Paying via Flavrly PG **does not** create marketing consent. Loyalty and CRM events (master prompt §15) must check an explicit opt-in. No marketing opt-in field was found in `apps/web/prisma/schema.prisma` (grep 2026-10-24). | Consent field + enforcement test (Agent F scope). | OPEN | Owner + Lead |
| G-MKT-2 | Promotional SMS/WhatsApp: TRAI TCCCPR 2018 / DLT registration of headers and templates, and preference/consent scrubbing. **UNVERIFIED** (TRAI text not fetched this session). | DLT registration record. | OPEN | Owner (human) |

### G-REF: refunds, failed transactions and disputes

Source (fetched): RBI circular DPSS.CO.PD No.629/02.01.014/2019-20, 20 Sep 2019, *Harmonisation of TAT
and customer compensation for failed transactions*, https://rbi.org.in/Scripts/NotificationUser.aspx?Id=11693.
It is addressed to "Operators and Participants of Authorised Payment Systems". For UPI:
- Debited but beneficiary not credited: auto-reversal by T+1, then ₹100/day.
- Debited but merchant confirmation not received: auto-reversal by T+5, then ₹100/day.

These duties sit with banks/PSPs. **Flavrly is not a system participant**, so they do not bind
Flavrly directly. But in the direct-to-merchant model, a customer who was debited and credited to the
restaurant **will not be auto-reversed by any bank**, because the credit succeeded. The refund falls to
the restaurant (D13 manual bank refund).

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-REF-1 | Restaurant agreement clause: the restaurant is responsible for refunding direct-UPI payments (overcollection, cancelled order, late payment) within a stated TAT. Flavrly records the evidence (D13). | Signed restaurant terms. | BLOCKED | Owner (human) + counsel |
| G-REF-2 | Customer-facing refund and grievance policy for direct-UPI orders. It must not promise "automatic refund" (SAFE_PILOT_HARDENING item 6). | Published policy + copy review. | BLOCKED | Owner (human) |
| G-REF-3 | Dispute path: customers may raise UPI disputes through their bank/app (NPCI UDIR). The restaurant's bank then contacts the restaurant, not Flavrly. Ops need a way to answer with Flavrly's evidence. **UNVERIFIED** (UDIR circular not fetched). | Ops procedure in OPERATIONS_RUNBOOK. | OPEN | Ops (human) |
| G-REF-4 | Consumer Protection (E-Commerce) Rules, 2020: grievance officer, complaint acknowledgement within 48 h and redress within 1 month, refund obligations. **UNVERIFIED** (secondary sources only; official text not retrieved). | Counsel confirmation + published grievance officer. | OPEN | Owner + counsel |

### G-OSS: third-party dependency notices

| ID | Requirement | Evidence required | Status | Owner |
|---|---|---|---|---|
| G-OSS-1 | Licence inventory and notices for Flavrly web (`apps/web`), the fork (Node packages), and the observer APK. The APK bundles `app/libs/core-3.5.3.jar` (ZXing, Apache-2.0, **UNVERIFIED**: version/licence not inspected) and declares AndroidX/OkHttp in Gradle. | Generated SBOM + NOTICE file shipped with the APK and the services. | OPEN | Lead (engineering) |

## 3. Release rule

Real-money activation (`FLAVRLY_PG_NEW_PAYMENTS_ENABLED=true` in production) stays **NO-GO** until
every BLOCKED row above is cleared with the stated evidence. The owner records the go/no-go
decision (master prompt §24). OPEN rows must have a dated plan before a pilot.

## 4. Sources actually consulted this session

- RBI PA Directions 2025 (MD id 12896): fetched; supports PA/PG definitions, authorisation and escrow (G-RBI).
- RBI TAT circular 2019 (Notification 11693): fetched; supports the UPI T+1/T+5 and ₹100/day figures (G-REF).
- DPDP Rules 2025 gazette PDF (MeitY): downloaded and text-extracted; supports Rules 1, 6(1)(e) and 7 (G-DPDP).
- `gh issue view` #56, #58, #70, #82, #89 (youpi-pg/YouPI-PG): issue states.
- Local git reads of d7b0741 / 7720b49 / ec8b986: licence and APK facts.
- Not fetched (UNVERIFIED): NPCI MDR/P2PM FAQ (redirect loop), NPCI UDIR, TRAI TCCCPR, Google Play policy, official Consumer Protection (E-Commerce) Rules text.
