-- Restaurant settlement / payout configuration for the partner Settlement Report.
ALTER TABLE "Restaurant" ADD COLUMN     "paymentFeePct" DOUBLE PRECISION NOT NULL DEFAULT 2.0;
ALTER TABLE "Restaurant" ADD COLUMN     "legalName" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN     "gstin" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN     "pan" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN     "bankAccountLast4" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN     "settlementCycle" TEXT NOT NULL DEFAULT 'WEEKLY';
