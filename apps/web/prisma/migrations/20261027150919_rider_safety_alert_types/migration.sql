-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EscalationType" ADD VALUE 'ROUTE_DEVIATION';
ALTER TYPE "EscalationType" ADD VALUE 'ETA_BREACH';
ALTER TYPE "EscalationType" ADD VALUE 'LONG_WAIT_AT_RESTAURANT';
ALTER TYPE "EscalationType" ADD VALUE 'SIGNAL_LOST';
