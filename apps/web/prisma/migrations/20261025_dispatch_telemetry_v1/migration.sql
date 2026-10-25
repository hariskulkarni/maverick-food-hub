-- Dispatch telemetry v1 (feat/dispatch-telemetry). Additive only: 2 enums, 1 enum value, 4 tables.
-- Hand-trimmed: `migrate dev` also emitted pre-existing schema drift unrelated to this change; that is NOT included.

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('ACCEPTED', 'PREP_STARTED', 'FOOD_READY', 'INVITED', 'ASSIGNED', 'ARRIVED_RESTAURANT', 'PICKED_UP', 'ARRIVED_CUSTOMER', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderEventSource" AS ENUM ('SYSTEM', 'KITCHEN', 'RIDER', 'ADMIN');

-- AlterEnum
ALTER TYPE "EscalationType" ADD VALUE 'RIDER_STATIONARY';

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "source" "OrderEventSource" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "riderId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "dedupeKey" TEXT,
    "meta" JSONB,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDispatchPlan" (
    "orderId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "predictedPrepMin" DOUBLE PRECISION NOT NULL,
    "prepSource" TEXT NOT NULL,
    "prepSamples" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "releaseAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "jit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDispatchPlan_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "RestaurantPrepStat" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "hourBucket" INTEGER NOT NULL,
    "samples" INTEGER NOT NULL,
    "p50Min" DOUBLE PRECISION NOT NULL,
    "p60Min" DOUBLE PRECISION NOT NULL,
    "p90Min" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantPrepStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneSupplyDemand" (
    "id" TEXT NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "h3Cell" TEXT NOT NULL,
    "openOrders" INTEGER NOT NULL DEFAULT 0,
    "idleRiders" INTEGER NOT NULL DEFAULT 0,
    "busyRiders" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ZoneSupplyDemand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- CreateIndex
CREATE INDEX "OrderEvent_type_at_idx" ON "OrderEvent"("type", "at");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_orderId_dedupeKey_key" ON "OrderEvent"("orderId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OrderDispatchPlan_jit_releasedAt_releaseAt_idx" ON "OrderDispatchPlan"("jit", "releasedAt", "releaseAt");

-- CreateIndex
CREATE INDEX "OrderDispatchPlan_restaurantId_acceptedAt_idx" ON "OrderDispatchPlan"("restaurantId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantPrepStat_restaurantId_hourBucket_key" ON "RestaurantPrepStat"("restaurantId", "hourBucket");

-- CreateIndex
CREATE INDEX "ZoneSupplyDemand_bucketAt_idx" ON "ZoneSupplyDemand"("bucketAt");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneSupplyDemand_bucketAt_h3Cell_key" ON "ZoneSupplyDemand"("bucketAt", "h3Cell");
