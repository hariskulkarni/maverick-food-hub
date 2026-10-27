-- CreateEnum
CREATE TYPE "CallLogStatus" AS ENUM ('REQUESTED', 'QUEUED', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCallSid" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'RIDER_TO_CUSTOMER',
    "assignmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "initiatedById" TEXT,
    "status" "CallLogStatus" NOT NULL DEFAULT 'REQUESTED',
    "durationSec" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "riderLegStatus" TEXT,
    "customerLegStatus" TEXT,
    "failureReason" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_providerCallSid_key" ON "CallLog"("providerCallSid");

-- CreateIndex
CREATE INDEX "CallLog_assignmentId_createdAt_idx" ON "CallLog"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_orderId_createdAt_idx" ON "CallLog"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_riderId_createdAt_idx" ON "CallLog"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_status_createdAt_idx" ON "CallLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
