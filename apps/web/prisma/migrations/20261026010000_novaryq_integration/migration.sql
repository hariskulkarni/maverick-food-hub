-- CreateEnum
CREATE TYPE "NovaryqSyncState" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD', 'CANCEL_PENDING', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EscalationType" ADD VALUE 'POS_VOIDED';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'NOVARYQ';

-- CreateTable
CREATE TABLE "NovaryqLocationLink" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "novaryqLocationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovaryqLocationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovaryqItemLink" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "novaryqItemCode" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "NovaryqItemLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovaryqOrderSync" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "state" "NovaryqSyncState" NOT NULL DEFAULT 'PENDING',
    "novaryqOrderId" TEXT,
    "novaryqOrderNumber" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastStatus" TEXT,
    "lastStatusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovaryqOrderSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovaryqWebhookEvent" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaryqWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NovaryqLocationLink_branchId_key" ON "NovaryqLocationLink"("branchId");

-- CreateIndex
CREATE INDEX "NovaryqLocationLink_restaurantId_idx" ON "NovaryqLocationLink"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "NovaryqItemLink_menuItemId_key" ON "NovaryqItemLink"("menuItemId");

-- CreateIndex
CREATE INDEX "NovaryqItemLink_restaurantId_novaryqItemCode_idx" ON "NovaryqItemLink"("restaurantId", "novaryqItemCode");

-- CreateIndex
CREATE UNIQUE INDEX "NovaryqOrderSync_orderId_key" ON "NovaryqOrderSync"("orderId");

-- CreateIndex
CREATE INDEX "NovaryqOrderSync_state_nextAttemptAt_idx" ON "NovaryqOrderSync"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NovaryqOrderSync_restaurantId_state_idx" ON "NovaryqOrderSync"("restaurantId", "state");

-- CreateIndex
CREATE INDEX "NovaryqOrderSync_novaryqOrderId_idx" ON "NovaryqOrderSync"("novaryqOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "NovaryqWebhookEvent_deliveryId_key" ON "NovaryqWebhookEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "NovaryqWebhookEvent_processedAt_nextAttemptAt_idx" ON "NovaryqWebhookEvent"("processedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NovaryqWebhookEvent_restaurantId_receivedAt_idx" ON "NovaryqWebhookEvent"("restaurantId", "receivedAt");

-- AddForeignKey
ALTER TABLE "NovaryqLocationLink" ADD CONSTRAINT "NovaryqLocationLink_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqLocationLink" ADD CONSTRAINT "NovaryqLocationLink_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqItemLink" ADD CONSTRAINT "NovaryqItemLink_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqItemLink" ADD CONSTRAINT "NovaryqItemLink_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqOrderSync" ADD CONSTRAINT "NovaryqOrderSync_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqOrderSync" ADD CONSTRAINT "NovaryqOrderSync_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovaryqWebhookEvent" ADD CONSTRAINT "NovaryqWebhookEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

