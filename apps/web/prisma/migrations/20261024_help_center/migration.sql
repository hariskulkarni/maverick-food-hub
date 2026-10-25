-- Knowledge base / help center (feat/knowledge-base).
-- KB tables only. HelpArticle.searchVector is written by the app on every save
-- (src/server/help/search.ts refreshSearchVector) so it also works on databases
-- synced with 'prisma db push'.

-- CreateEnum
CREATE TYPE "HelpAudience" AS ENUM ('RESTAURANT_ADMIN', 'KITCHEN', 'RIDER', 'CUSTOMER', 'ALL');

-- CreateEnum
CREATE TYPE "HelpLanguage" AS ENUM ('en', 'hi');

-- CreateEnum
CREATE TYPE "HelpArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "HelpCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "audience" "HelpAudience" NOT NULL DEFAULT 'ALL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "language" "HelpLanguage" NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "HelpAudience"[],
    "tags" TEXT[],
    "status" "HelpArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "appArea" TEXT,
    "relatedSlugs" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "categoryId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchVector" tsvector,

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticleVersion" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "HelpAudience"[],
    "tags" TEXT[],
    "appArea" TEXT,
    "categoryId" TEXT,
    "note" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpArticleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticleFeedback" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticleFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpSearchLog" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "resultsCount" INTEGER NOT NULL,
    "language" "HelpLanguage" NOT NULL DEFAULT 'en',
    "source" TEXT NOT NULL,
    "role" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpSearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpCategory_slug_key" ON "HelpCategory"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_status_language_idx" ON "HelpArticle"("status", "language");

-- CreateIndex
CREATE INDEX "HelpArticle_appArea_idx" ON "HelpArticle"("appArea");

-- CreateIndex
CREATE INDEX "HelpArticle_categoryId_idx" ON "HelpArticle"("categoryId");

-- CreateIndex
CREATE INDEX "HelpArticle_searchVector_idx" ON "HelpArticle" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_slug_language_key" ON "HelpArticle"("slug", "language");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticleVersion_articleId_version_key" ON "HelpArticleVersion"("articleId", "version");

-- CreateIndex
CREATE INDEX "HelpArticleFeedback_articleId_helpful_idx" ON "HelpArticleFeedback"("articleId", "helpful");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticleFeedback_articleId_userId_key" ON "HelpArticleFeedback"("articleId", "userId");

-- CreateIndex
CREATE INDEX "HelpSearchLog_createdAt_idx" ON "HelpSearchLog"("createdAt");

-- CreateIndex
CREATE INDEX "HelpSearchLog_resultsCount_createdAt_idx" ON "HelpSearchLog"("resultsCount", "createdAt");

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticleVersion" ADD CONSTRAINT "HelpArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "HelpArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticleFeedback" ADD CONSTRAINT "HelpArticleFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "HelpArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Typo-tolerant search fallback uses pg_trgm (similarity / word_similarity).
-- pg_trgm is a trusted extension on PostgreSQL 13+, so a database owner can
-- create it without superuser. If it still cannot be created, the migration
-- must not fail: search degrades to an ILIKE fallback at runtime.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR undefined_file THEN
  RAISE NOTICE 'pg_trgm unavailable (%); help search will use the ILIKE fallback', SQLERRM;
END
$$;
