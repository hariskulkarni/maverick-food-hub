-- Review response & insights (feat/google-reviews-advanced).
-- GoogleReview/ReviewReply exist in production via `prisma db push` but are not
-- created by any earlier migration on main, so statements touching them are guarded.
-- AlterTable
ALTER TABLE IF EXISTS "GoogleReview" ADD COLUMN IF NOT EXISTS "alertedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "matchCheckedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "matchConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "matchedOrderId" TEXT,
ADD COLUMN IF NOT EXISTS "media" JSONB,
ADD COLUMN IF NOT EXISTS "reviewUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE IF EXISTS "ReviewReply" ADD COLUMN IF NOT EXISTS "holdReason" TEXT,
ADD COLUMN IF NOT EXISTS "moderationState" TEXT,
ADD COLUMN IF NOT EXISTS "policyViolation" TEXT,
ADD COLUMN IF NOT EXISTS "reviewReplyUrl" TEXT;

-- CreateTable
CREATE TABLE "ReviewResponseSettings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "skipKeywords" TEXT[] DEFAULT ARRAY['food poisoning', 'allergy', 'allergic', 'refund', 'legal', 'lawyer', 'sick', 'hospital', 'hair in']::TEXT[],
    "brandVoiceSummary" TEXT,
    "brandVoiceUpdatedAt" TIMESTAMP(3),
    "alertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "alertMaxRating" INTEGER NOT NULL DEFAULT 2,
    "alertSms" BOOLEAN NOT NULL DEFAULT false,
    "alertWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "slaHours" INTEGER NOT NULL DEFAULT 24,
    "escalationEmail" TEXT,
    "escalationPhone" TEXT,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestSms" BOOLEAN NOT NULL DEFAULT false,
    "digestWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "digestLastSentAt" TIMESTAMP(3),
    "googleAverageRating" DOUBLE PRECISION,
    "googleTotalReviewCount" INTEGER,
    "googleStatsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewResponseSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReplyTemplate" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewReplyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAnalysis" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "issues" TEXT[],
    "dishes" JSONB NOT NULL,
    "staff" TEXT[],
    "method" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewInsightsSnapshot" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewInsightsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewResponseSettings_restaurantId_key" ON "ReviewResponseSettings"("restaurantId");

-- CreateIndex
CREATE INDEX "ReviewReplyTemplate_restaurantId_idx" ON "ReviewReplyTemplate"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnalysis_reviewId_key" ON "ReviewAnalysis"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewAnalysis_restaurantId_idx" ON "ReviewAnalysis"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewInsightsSnapshot_restaurantId_key" ON "ReviewInsightsSnapshot"("restaurantId");

-- AddForeignKey
ALTER TABLE "ReviewResponseSettings" ADD CONSTRAINT "ReviewResponseSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReplyTemplate" ADD CONSTRAINT "ReviewReplyTemplate_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (guarded: GoogleReview was created via `db push`, not a migration, on main)
DO $$ BEGIN
  IF to_regclass('"GoogleReview"') IS NOT NULL THEN
    ALTER TABLE "ReviewAnalysis" ADD CONSTRAINT "ReviewAnalysis_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "GoogleReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "ReviewAnalysis" ADD CONSTRAINT "ReviewAnalysis_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewInsightsSnapshot" ADD CONSTRAINT "ReviewInsightsSnapshot_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

