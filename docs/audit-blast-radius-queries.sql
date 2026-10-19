-- Audit 2026-10-19 — blast-radius sizing queries (C4, C5, C13)
--
-- ##############################################################################
-- ## READ-ONLY. DO NOT run these automatically. Hand to a human to run against ##
-- ## the PRODUCTION PostgreSQL database to size how much damage already        ##
-- ## happened. Every statement is SELECT-only; none writes. Run inside a       ##
-- ## read-only transaction if you want a hard guarantee:                       ##
-- ##     BEGIN TRANSACTION READ ONLY;  <query>  ROLLBACK;                       ##
-- ##                                                                           ##
-- ## Table/column names are the Prisma model names (no @@map), so identifiers  ##
-- ## are quoted PascalCase. "Order" is a reserved word — keep it quoted.       ##
-- ##############################################################################


-- ============================================================================
-- C4 — wallet balances debited beyond the amount owed
-- Finds ORDER_DEBIT wallet transactions whose amount exceeds the order's
-- pre-wallet amount owed (subtotal + tax + delivery + packaging − discount).
-- These are customers whose wallet was over-drained; the excess is the money
-- to refund. (Loyalty has the identical bug — second query.)
-- ============================================================================
SELECT
  wt."id"            AS wallet_txn_id,
  wt."walletId",
  wt."orderId",
  o."code"           AS order_code,
  o."customerId",
  wt."amount"        AS wallet_debited,
  (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
                     AS pre_wallet_owed,
  wt."amount"
    - (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
                     AS excess_debited,
  o."total"          AS order_total,
  wt."createdAt"
FROM "WalletTransaction" wt
JOIN "Order" o ON o."id" = wt."orderId"
WHERE wt."type" = 'ORDER_DEBIT'
  AND wt."amount" >
      (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
ORDER BY excess_debited DESC;

-- C4 (loyalty variant) — loyalty points redeemed beyond the amount owed after
-- wallet. Approximate: treats 1 point = ₹1 (as the code does).
SELECT
  o."id"             AS order_id,
  o."code"           AS order_code,
  o."customerId",
  o."loyaltyApplied",
  o."walletApplied",
  GREATEST(
    0,
    (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
      - o."walletApplied"
  )                  AS owed_after_wallet,
  o."loyaltyApplied"
    - GREATEST(
        0,
        (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
          - o."walletApplied"
      )               AS excess_loyalty
FROM "Order" o
WHERE o."loyaltyApplied" >
      GREATEST(
        0,
        (o."subtotal" + o."taxAmount" + o."deliveryFee" + o."packagingFee" - o."discountAmount")
          - o."walletApplied"
      )
ORDER BY excess_loyalty DESC;


-- ============================================================================
-- C5 — refunds reported COMPLETED that never hit a gateway
-- The refund code writes providerData = { provider, mock: true } and
-- status = COMPLETED when no real gateway credential could be resolved. These
-- are refunds the customer and the books say happened but no money moved.
-- ============================================================================
SELECT
  r."id"            AS refund_id,
  r."orderId",
  r."paymentId",
  r."amount",
  r."status",
  r."providerRef",
  r."providerData",
  r."createdAt"
FROM "Refund" r
WHERE r."providerData" ->> 'mock' = 'true'
  AND r."status" = 'COMPLETED'
ORDER BY r."createdAt" DESC;


-- ============================================================================
-- C13 — rider KYC documents approved by the random mock verifier
-- kyc.ts auto-APPROVES PAN / driving licences on a mock PASS. The mock flag is
-- stored in verifierProvider='mock' (the audit wrote this as details->>'mock';
-- the actual column is verifierProvider). These riders were never verified
-- against any external source.
-- ============================================================================
SELECT
  d."id"              AS kyc_document_id,
  d."riderId",
  d."type",
  d."status",
  d."verifierProvider",
  d."verifierStatus",
  d."verifiedAt",
  d."reviewedAt"
FROM "RiderKycDocument" d
WHERE d."verifierProvider" = 'mock'
  AND d."status" = 'APPROVED'
ORDER BY d."verifiedAt" DESC;

-- C13 (count only)
SELECT d."type", COUNT(*) AS approved_by_mock
FROM "RiderKycDocument" d
WHERE d."verifierProvider" = 'mock' AND d."status" = 'APPROVED'
GROUP BY d."type";
