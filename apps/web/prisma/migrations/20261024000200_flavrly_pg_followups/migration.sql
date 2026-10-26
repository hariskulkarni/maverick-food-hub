-- AlterTable
ALTER TABLE "PgPaymentAttempt" ADD COLUMN     "payableAmountPaise" INTEGER;

-- AlterTable
ALTER TABLE "PgRefundRecord" ADD COLUMN     "allocationKind" "PgAllocationKind" NOT NULL DEFAULT 'ORDER_PAYMENT';

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_processed_nextAttemptAt_idx" ON "PaymentWebhookEvent"("provider", "processed", "nextAttemptAt");


-- Fork gateways add a 0..99 paise offset to the payable amount; anything else is not a valid binding.
ALTER TABLE "PgPaymentAttempt" ADD CONSTRAINT "PgPaymentAttempt_payable_offset_chk"
  CHECK ("payableAmountPaise" IS NULL OR ("payableAmountPaise" >= "expectedAmountPaise" AND "payableAmountPaise" <= "expectedAmountPaise" + 99));

-- A bank refund reference is recorded once (race-proof across attempts).
CREATE UNIQUE INDEX "PgRefundRecord_bankReference_live_key" ON "PgRefundRecord"("bankReference") WHERE "bankReference" IS NOT NULL;
