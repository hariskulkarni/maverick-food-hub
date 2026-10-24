-- AlterEnum
ALTER TYPE "PgExceptionKind" ADD VALUE 'RELEASE_HELD';

-- AlterTable
ALTER TABLE "PgRefundRecord" ADD COLUMN     "bankTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PgRefundRecord_bankTransactionId_key" ON "PgRefundRecord"("bankTransactionId");
