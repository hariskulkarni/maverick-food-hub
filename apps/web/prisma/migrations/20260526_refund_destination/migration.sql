-- Refund destination + status + issuer. Wallet-first refund policy: a refund
-- defaults to the customer's wallet; an admin may opt to send it back to the
-- original payment method (gateway). paymentId becomes optional so wallet
-- refunds (incl. COD orders with no captured payment) can be recorded.

-- Enums
CREATE TYPE "RefundDestination" AS ENUM ('WALLET', 'ORIGINAL_PAYMENT');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- Drop the existing NOT NULL + FK on paymentId so it can be nullable.
ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_paymentId_fkey";
ALTER TABLE "Refund" ALTER COLUMN "paymentId" DROP NOT NULL;

-- New columns
ALTER TABLE "Refund" ADD COLUMN     "destination" "RefundDestination" NOT NULL DEFAULT 'WALLET';
ALTER TABLE "Refund" ADD COLUMN     "status" "RefundStatus" NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "Refund" ADD COLUMN     "createdById" TEXT;

-- Re-add the FK, now nullable, with the same cascade behaviour.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Refund_orderId_idx" ON "Refund"("orderId");
