-- CreateEnum
CREATE TYPE "RiderIntegrityStatus" AS ENUM ('CLEAR', 'FLAGGED', 'CLEARED');

-- CreateEnum
CREATE TYPE "RiderIntegrityVerdict" AS ENUM ('MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY', 'FAILED', 'UNEVALUATED');

-- AlterTable
ALTER TABLE "RiderProfile" ADD COLUMN     "locationSuspect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offersPaused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RiderSpoofEvent" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSpoofEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderIntegrityState" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "RiderIntegrityStatus" NOT NULL DEFAULT 'CLEAR',
    "shiftStartedAt" TIMESTAMP(3),
    "mockPingCount" INTEGER NOT NULL DEFAULT 0,
    "spoofEventCount" INTEGER NOT NULL DEFAULT 0,
    "spoofScore" INTEGER NOT NULL DEFAULT 0,
    "lastSpoofAt" TIMESTAMP(3),
    "verdict" "RiderIntegrityVerdict" NOT NULL DEFAULT 'UNEVALUATED',
    "verdictDetail" TEXT,
    "verdictCheckedAt" TIMESTAMP(3),
    "flaggedAt" TIMESTAMP(3),
    "flaggedReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderIntegrityState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderIntegrityConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "mockPingThreshold" INTEGER NOT NULL DEFAULT 3,
    "autoPauseOffers" BOOLEAN NOT NULL DEFAULT false,
    "gateOnlineOnFailed" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderIntegrityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderSpoofEvent_riderId_at_idx" ON "RiderSpoofEvent"("riderId", "at");

-- CreateIndex
CREATE INDEX "RiderSpoofEvent_at_idx" ON "RiderSpoofEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX "RiderIntegrityState_riderId_key" ON "RiderIntegrityState"("riderId");

-- CreateIndex
CREATE INDEX "RiderIntegrityState_status_idx" ON "RiderIntegrityState"("status");

-- CreateIndex
CREATE INDEX "RiderProfile_locationSuspect_idx" ON "RiderProfile"("locationSuspect");

-- AddForeignKey
ALTER TABLE "RiderSpoofEvent" ADD CONSTRAINT "RiderSpoofEvent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderIntegrityState" ADD CONSTRAINT "RiderIntegrityState_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
