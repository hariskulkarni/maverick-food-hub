# Flavrly PG: Safe Pilot Hardening (October 22, 2026)

**Status: partial code hardening, production NO-GO.** This branch is additive and non-deploying. It deliberately does not change the default PhonePe/Razorpay payment-provider selection or their existing webhook/refund contracts. Existing in-flight Flavrly PG reconciliation stays accessible even if the switch for NEW checkouts is disabled.

## Implemented narrow safeguards

1. `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` defaults to OFF in production. It blocks NEW Flavrly PG provider selection and hides that choice from checkout; existing webhook/status/sweeper code is not switched off. In test/development, the switch does not block mocked flows.
2. Flavrly PG's server-to-server payment POST includes `X-Merchant-Key` (optional dedicated `merchantKey`, falling back to the configured gateway merchant/webhook secret). The key stays server-only.
3. An explicit Flavrly PG order starts in `PAYMENT_PENDING`, not `RECEIVED`, so it does not appear in the kitchen work queue or generate a new-order chime until a later verified release. Other gateway orders/COD are intentionally unchanged pending broader regression coverage.
4. UPI gateway order identifiers use the **attempt-specific** merchant order ID, rather than the permanent order ID. The signed webhook can resolve a create-to-local-persist race through the pre-seeded `Payment.providerRef`, without deleting legacy bare-order-ID lookup.
5. A NEW production checkout requires `FLAVRLY_PG_CHECKOUT_ORIGIN`, an HTTPS-host match, and a private gateway status readback with the expected order, INR paise, and `metadata.receivingAccountSnapshot.upiId`. Absent or mismatched receiver readback stops redirecting the customer; it does NOT prove bank ownership.
6. Customer-facing direct-UPI failure/pending messaging no longer promises that an unconfirmed debit never happened or was automatically reversed. Direct-UPI retry on the status page is suppressed.

## Important P0/P1 gaps not solved by these changes

- **No authoritative bank-credit integration:** YouPI's webhook reports an observer-derived UTR, but the status API doesn't include the UTR. The existing `youpi-reconcile.ts` requires UTR from status, so real successful observer events may stay pending forever. Never replace this with unverified webhook UTR-based capture.
- **No verified merchant-bank ownership mapping:** the shared platform merchantId and restaurant VPA do not establish separate bank accounts. The status receiver readback detects a mismatch AFTER create but before redirect; it does not prevent creating sessions or prove who owns a VPA. Implement authenticated per-merchant binding before live checkout.
- **No independent bank ledger or bank-statement proof** and no durable bank-credit-to-order allocation transaction. SMS/Gmail/UPI screenshots/webhook status are not conclusive bank settlement.
- **Duplicate captured attempts:** the current `findFirst` then `updateMany` order-level guard is non-atomic. Add a constrained unique allocation, row locking, and an overcollection exception workflow.
- **Webhook durability:** the existing webhook can acknowledge failed reconciliation and relies on a sweeper; dedupe is recorded before processing and no robust pending-event retry/dead-letter semantics exist. Upstream webhook retry timestamps may become stale.
- **Cron advisory lock:** Prisma connection-pool session advisory locks may be released on different sessions. Replace with a safe DB lease or transaction-scoped ownership pattern.
- **Limits:** current caps are per restaurant, not receiving account; failed starts consume slots.
- **Refunds, settlement and reports:** direct bank receipts need a distinct cash ledger; paymentMethod currently reuses RAZORPAY/PHONEPE enum values with providerName='youpi'; existing reports and refund policies are not direct-UPI-aware.
- **Data retention and compliance:** implement bounded encrypted evidence retention; obtain upstream commercial-license terms and legal/bank approval before resale. An iframe embedding Authelia should not disable its full CSP policy without a separate review.
- **Tests:** changes were reviewed statically through GitHub tools. The app's test suite, compiler, build, DB migration, and any live payment were NOT run by this change author. Require green CI and staging acceptance before any merge or deployment.

## Activation / rollback

- Default behavior: leave `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` absent or false on production. `FLAVRLY_PG_CHECKOUT_ORIGIN=https://pay.flavrly.in` is needed only for NEW production checkout and should point to the actual vetted production checkout origin.
- No production DB migration is part of this first branch.
- Do not configure production payments until the bank-proof, merchant binding, idempotent ledger, refund/dispute, legal and full E2E controls above have been implemented and independently tested.
- Rollback code with a reversible PR revert; the feature flag can stop new Flavrly PG checkouts immediately without disabling reconciliation for already-created attempts.

## Required regression run

```bash
cd apps/web
npm ci
npx prisma validate
npm run typecheck
npm run test:ci
npm run lint
npm run build
```

Pay special attention to `youpi-api.test.ts`, `youpi-provider.test.ts`, `youpi-webhook.test.ts`, `youpi-order-policy.test.ts` and existing `phonepe-*.test.ts` / Razorpay/refund/order/kitchen tests. Release is explicitly blocked if any previously supported production flow regresses.

See `docs/YOUPI-SELF-HOST.md` and the external audit/Claude Code CLI remediation pack for phase-by-phase implementation instructions.
