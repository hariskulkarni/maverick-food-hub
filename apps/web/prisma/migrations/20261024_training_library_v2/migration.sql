-- Training library v2 (feat/training-library).
-- Additive only: new enum values, new TrainingModule columns, lesson/quiz/progress/certificate
-- tables, and a backfill that turns existing completed RiderTrainingProgress rows into
-- version-1 certificates so no learner history is lost.

-- AlterEnum
ALTER TYPE "TrainingCategory" ADD VALUE IF NOT EXISTS 'HYGIENE';
ALTER TYPE "TrainingCategory" ADD VALUE IF NOT EXISTS 'KITCHEN_OPS';
ALTER TYPE "TrainingCategory" ADD VALUE IF NOT EXISTS 'RESTAURANT_OPS';

-- CreateEnum
CREATE TYPE "TrainingAudience" AS ENUM ('RIDER', 'KITCHEN', 'RESTAURANT_ADMIN');

CREATE TYPE "TrainingLessonKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'CHECKLIST');

-- AlterTable
ALTER TABLE "TrainingModule" ADD COLUMN     "audience" "TrainingAudience" NOT NULL DEFAULT 'RIDER',
ADD COLUMN     "blocksShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "passMarkPct" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "retakeCooldownMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "translations" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "versionPublishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "TrainingLesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" "TrainingLessonKind" NOT NULL DEFAULT 'TEXT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "mediaUrl" TEXT,
    "checklistItems" JSONB,
    "translations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuestion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "translations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLessonCompletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "moduleVersion" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingLessonCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleVersion" INTEGER NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "answers" JSONB,
    "source" TEXT NOT NULL DEFAULT 'app',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingQuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleVersion" INTEGER NOT NULL,
    "scorePct" INTEGER,
    "code" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingLesson_moduleId_order_idx" ON "TrainingLesson"("moduleId", "order");

-- CreateIndex
CREATE INDEX "TrainingQuestion_moduleId_order_idx" ON "TrainingQuestion"("moduleId", "order");

-- CreateIndex
CREATE INDEX "TrainingLessonCompletion_userId_moduleId_idx" ON "TrainingLessonCompletion"("userId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingLessonCompletion_userId_lessonId_key" ON "TrainingLessonCompletion"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "TrainingQuizAttempt_userId_moduleId_moduleVersion_idx" ON "TrainingQuizAttempt"("userId", "moduleId", "moduleVersion");

-- CreateIndex
CREATE INDEX "TrainingQuizAttempt_moduleId_createdAt_idx" ON "TrainingQuizAttempt"("moduleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCertificate_code_key" ON "TrainingCertificate"("code");

-- CreateIndex
CREATE INDEX "TrainingCertificate_userId_idx" ON "TrainingCertificate"("userId");

-- CreateIndex
CREATE INDEX "TrainingCertificate_moduleId_moduleVersion_idx" ON "TrainingCertificate"("moduleId", "moduleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCertificate_userId_moduleId_moduleVersion_key" ON "TrainingCertificate"("userId", "moduleId", "moduleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModule_slug_key" ON "TrainingModule"("slug");

-- CreateIndex
CREATE INDEX "TrainingModule_audience_isActive_order_idx" ON "TrainingModule"("audience", "isActive", "order");

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuestion" ADD CONSTRAINT "TrainingQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonCompletion" ADD CONSTRAINT "TrainingLessonCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonCompletion" ADD CONSTRAINT "TrainingLessonCompletion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonCompletion" ADD CONSTRAINT "TrainingLessonCompletion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "TrainingLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuizAttempt" ADD CONSTRAINT "TrainingQuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuizAttempt" ADD CONSTRAINT "TrainingQuizAttempt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCertificate" ADD CONSTRAINT "TrainingCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCertificate" ADD CONSTRAINT "TrainingCertificate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing completed rider progress -> version-1 certificates.
INSERT INTO "TrainingCertificate" ("id", "userId", "moduleId", "moduleVersion", "scorePct", "code", "issuedAt")
SELECT
  'cert_' || md5(p."id"),
  rp."userId",
  p."moduleId",
  1,
  p."quizScore",
  'FLV-' || upper(substr(md5(p."id" || 'cert'), 1, 10)),
  COALESCE(p."completedAt", p."updatedAt")
FROM "RiderTrainingProgress" p
JOIN "RiderProfile" rp ON rp."id" = p."riderId"
WHERE p."completed" = true
ON CONFLICT DO NOTHING;
