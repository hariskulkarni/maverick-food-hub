-- Catch-up migration for schema drift introduced by `prisma db push` (scripts/fix-prod.sh,
-- scripts/deploy-remote.sh --migrate) without committed migrations.
-- Generated with:
--   prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel <schema.prisma @ eebd11f> --shadow-database-url <shadow> --script
-- then made IDEMPOTENT so it applies cleanly both to a database built only from migrations
-- AND to a database that already received these objects via `db push`:
--   enums      -> DO $$ CREATE TYPE ... EXCEPTION WHEN duplicate_object $$
--   enum value -> ADD VALUE IF NOT EXISTS
--   columns    -> ADD COLUMN IF NOT EXISTS
--   tables     -> CREATE TABLE IF NOT EXISTS
--   indexes    -> CREATE [UNIQUE] INDEX IF NOT EXISTS
--   FKs        -> DO $$ ADD CONSTRAINT ... EXCEPTION WHEN duplicate_object $$
-- No data is dropped or rewritten. See docs/flavrly-pg/DATABASE_MIGRATIONS.md.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AddressLabel" AS ENUM ('HOME', 'WORK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DeliveryZoneType" AS ENUM ('POLYGON', 'CIRCLE', 'PINCODE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ModerationStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'FLAGGED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ReviewReplyState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ReviewReplySource" AS ENUM ('AUTO', 'MANUAL', 'ADMIN_EDITED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "YoupiRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'META_WHATSAPP';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_BUSINESS';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'LLM_REVIEWS';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'YOUPI';

-- AlterTable
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "floor" TEXT,
ADD COLUMN IF NOT EXISTS "instructions" TEXT,
ADD COLUMN IF NOT EXISTS "labelName" TEXT,
ADD COLUMN IF NOT EXISTS "labelType" "AddressLabel",
ADD COLUMN IF NOT EXISTS "landmark" TEXT;

-- AlterTable
ALTER TABLE "Offer" ALTER COLUMN "fulfillmentScope" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "feedbackRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderFeedback" ADD COLUMN IF NOT EXISTS "flagReason" TEXT,
ADD COLUMN IF NOT EXISTS "moderatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "moderatedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN IF NOT EXISTS "reply" TEXT,
ADD COLUMN IF NOT EXISTS "replyAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "replyByUserId" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "depositProviderOrderId" TEXT;

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "autoPublishReviews" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RiderPreferences" ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT,
ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT DEFAULT 'en';

-- AlterTable
ALTER TABLE "TrainingModule" ADD COLUMN IF NOT EXISTS "contentBlocks" JSONB,
ADD COLUMN IF NOT EXISTS "contentVersion" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS "heroImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "totpPendingSecret" TEXT,
ADD COLUMN IF NOT EXISTS "totpSecret" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeliveryZone" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeliveryZoneType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "polygon" JSONB,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feeBrackets" JSONB NOT NULL DEFAULT '[]',
    "distanceTiers" JSONB NOT NULL DEFAULT '[]',
    "minOrder" DECIMAL(10,2),
    "etaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebPushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RiderArrival" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderArrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsErrorLog" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'ERROR',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "digest" TEXT,
    "sampleStack" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ObsErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsProbe" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "detail" TEXT,
    "meta" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObsProbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsProbeEvent" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObsProbeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteContent" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoogleReview" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "googleReviewId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewCreatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'gbp',

    CONSTRAINT "GoogleReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReviewReply" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "state" "ReviewReplyState" NOT NULL DEFAULT 'DRAFT',
    "text" TEXT NOT NULL,
    "source" "ReviewReplySource" NOT NULL,
    "llmProvider" TEXT,
    "llmModel" TEXT,
    "postedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReviewAutoReplyConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPostMinRating" INTEGER NOT NULL DEFAULT 4,
    "draftMaxRating" INTEGER NOT NULL DEFAULT 3,
    "tonePrompt" TEXT,
    "enabledAt" TIMESTAMP(3),
    "googlePlaceId" TEXT,
    "googlePlaceName" TEXT,
    "googlePlaceConnectedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewAutoReplyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "YoupiDailyUsage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoupiDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "YoupiFeatureRequest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "YoupiRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoupiFeatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeliveryZone_branchId_priority_idx" ON "DeliveryZone"("branchId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebPushSubscription_userId_idx" ON "WebPushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RiderArrival_orderId_phase_key" ON "RiderArrival"("orderId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ObsErrorLog_fingerprint_key" ON "ObsErrorLog"("fingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsErrorLog_lastSeenAt_idx" ON "ObsErrorLog"("lastSeenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsErrorLog_level_idx" ON "ObsErrorLog"("level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsErrorLog_resolvedAt_idx" ON "ObsErrorLog"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ObsProbe_target_key" ON "ObsProbe"("target");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsProbe_category_idx" ON "ObsProbe"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsProbe_status_idx" ON "ObsProbe"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsProbeEvent_target_at_idx" ON "ObsProbeEvent"("target", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObsProbeEvent_at_idx" ON "ObsProbeEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleReview_googleReviewId_key" ON "GoogleReview"("googleReviewId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoogleReview_restaurantId_reviewCreatedAt_idx" ON "GoogleReview"("restaurantId", "reviewCreatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoogleReview_restaurantId_rating_idx" ON "GoogleReview"("restaurantId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewReply_reviewId_key" ON "ReviewReply"("reviewId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReviewReply_restaurantId_state_idx" ON "ReviewReply"("restaurantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewAutoReplyConfig_restaurantId_key" ON "ReviewAutoReplyConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "YoupiDailyUsage_restaurantId_day_key" ON "YoupiDailyUsage"("restaurantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "YoupiFeatureRequest_restaurantId_key" ON "YoupiFeatureRequest"("restaurantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GoogleReview" ADD CONSTRAINT "GoogleReview_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "GoogleReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ReviewAutoReplyConfig" ADD CONSTRAINT "ReviewAutoReplyConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "YoupiDailyUsage" ADD CONSTRAINT "YoupiDailyUsage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "YoupiFeatureRequest" ADD CONSTRAINT "YoupiFeatureRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

