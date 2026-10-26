-- App releases (2026-10-25, feat/rider-web-portal): published native-app builds
-- served by /download/rider-app and reported by /api/app/rider/latest.
-- Additive only (new enums + table); no existing data touched.

-- CreateEnum
CREATE TYPE "AppReleasePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "AppReleaseChannel" AS ENUM ('STABLE', 'BETA');

-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL DEFAULT 'rider',
    "platform" "AppReleasePlatform" NOT NULL,
    "channel" "AppReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "versionName" TEXT NOT NULL,
    "versionCode" INTEGER NOT NULL,
    "fileRef" TEXT,
    "fileName" TEXT,
    "downloadUrl" TEXT,
    "storeUrl" TEXT,
    "sha256" TEXT,
    "fileSize" INTEGER,
    "releaseNotes" TEXT,
    "minSupportedVersionCode" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppRelease_app_platform_channel_isActive_idx" ON "AppRelease"("app", "platform", "channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_app_platform_channel_versionCode_key" ON "AppRelease"("app", "platform", "channel", "versionCode");
