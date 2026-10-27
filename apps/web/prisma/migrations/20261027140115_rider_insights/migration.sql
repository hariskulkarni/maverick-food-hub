-- CreateEnum
CREATE TYPE "RiderStatusEventType" AS ENUM ('ONLINE', 'OFFLINE', 'AUTO_OFFLINE', 'SIGNAL_LOST', 'SIGNAL_REGAINED');

-- AlterTable
ALTER TABLE "RiderHeartbeat" ADD COLUMN     "signalLostAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RiderStatusEvent" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "RiderStatusEventType" NOT NULL,
    "source" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDeviceSnapshot" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osName" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "appBuild" TEXT,
    "networkType" TEXT,
    "cellularGeneration" TEXT,
    "batteryLevel" INTEGER,
    "charging" BOOLEAN,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historyAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderDeviceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDeviceSample" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osName" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "appBuild" TEXT,
    "networkType" TEXT,
    "cellularGeneration" TEXT,
    "batteryLevel" INTEGER,
    "charging" BOOLEAN,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderDeviceSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTripSummary" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "droppedPoints" INTEGER NOT NULL DEFAULT 0,
    "distanceM" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "movingSec" INTEGER NOT NULL,
    "maxGapSec" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderTripSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderStatusEvent_riderId_at_idx" ON "RiderStatusEvent"("riderId", "at");

-- CreateIndex
CREATE INDEX "RiderStatusEvent_at_idx" ON "RiderStatusEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDeviceSnapshot_riderId_key" ON "RiderDeviceSnapshot"("riderId");

-- CreateIndex
CREATE INDEX "RiderDeviceSnapshot_capturedAt_idx" ON "RiderDeviceSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "RiderDeviceSample_riderId_capturedAt_idx" ON "RiderDeviceSample"("riderId", "capturedAt");

-- CreateIndex
CREATE INDEX "RiderDeviceSample_capturedAt_idx" ON "RiderDeviceSample"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderTripSummary_assignmentId_key" ON "RiderTripSummary"("assignmentId");

-- CreateIndex
CREATE INDEX "RiderTripSummary_riderId_endedAt_idx" ON "RiderTripSummary"("riderId", "endedAt");

-- AddForeignKey
ALTER TABLE "RiderStatusEvent" ADD CONSTRAINT "RiderStatusEvent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDeviceSnapshot" ADD CONSTRAINT "RiderDeviceSnapshot_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDeviceSample" ADD CONSTRAINT "RiderDeviceSample_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderTripSummary" ADD CONSTRAINT "RiderTripSummary_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RiderAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
