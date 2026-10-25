-- CreateEnum
CREATE TYPE "ReviewRequestChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'QR');

-- CreateEnum
CREATE TYPE "ReviewRequestStatus" AS ENUM ('SCHEDULED', 'SENT', 'CLICKED', 'FEEDBACK', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecoveryTicketStatus" AS ENUM ('OPEN', 'CONTACTED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "QrType" ADD VALUE 'REVIEW';

-- CreateTable
CREATE TABLE "ReviewRequestConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channels" "ReviewRequestChannel"[] DEFAULT ARRAY['SMS']::"ReviewRequestChannel"[],
    "delayMinutes" INTEGER NOT NULL DEFAULT 60,
    "quietStartHour" INTEGER DEFAULT 21,
    "quietEndHour" INTEGER DEFAULT 9,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderAfterHours" INTEGER NOT NULL DEFAULT 24,
    "frequencyCapDays" INTEGER NOT NULL DEFAULT 30,
    "lowRatingThreshold" INTEGER NOT NULL DEFAULT 3,
    "gbpPlaceId" TEXT,
    "gbpReviewUrl" TEXT,
    "googleReviewUrlOverride" TEXT,
    "whatsappTemplateName" TEXT,
    "whatsappTemplateLang" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT,
    "qrCodeId" TEXT,
    "channel" "ReviewRequestChannel" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "ReviewRequestStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "reminderDueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "feedbackAt" TIMESTAMP(3),
    "googleClickedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "comment" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequestOptOut" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "restaurantId" TEXT,
    "sourceRestaurantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRequestOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRecoveryTicket" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT,
    "reviewRequestId" TEXT,
    "customerId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "RecoveryTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "notes" TEXT,
    "goodwillNote" TEXT,
    "goodwillAt" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRecoveryTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequestConfig_restaurantId_key" ON "ReviewRequestConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_orderId_key" ON "ReviewRequest"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_dueAt_idx" ON "ReviewRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_reminderDueAt_idx" ON "ReviewRequest"("status", "reminderDueAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_restaurantId_createdAt_idx" ON "ReviewRequest"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_customerId_restaurantId_sentAt_idx" ON "ReviewRequest"("customerId", "restaurantId", "sentAt");

-- CreateIndex
CREATE INDEX "ReviewRequestOptOut_customerId_idx" ON "ReviewRequestOptOut"("customerId");

-- CreateIndex
CREATE INDEX "ReviewRequestOptOut_sourceRestaurantId_createdAt_idx" ON "ReviewRequestOptOut"("sourceRestaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRecoveryTicket_orderId_key" ON "ServiceRecoveryTicket"("orderId");

-- CreateIndex
CREATE INDEX "ServiceRecoveryTicket_restaurantId_status_createdAt_idx" ON "ServiceRecoveryTicket"("restaurantId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewRequestConfig" ADD CONSTRAINT "ReviewRequestConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecoveryTicket" ADD CONSTRAINT "ServiceRecoveryTicket_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecoveryTicket" ADD CONSTRAINT "ServiceRecoveryTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

