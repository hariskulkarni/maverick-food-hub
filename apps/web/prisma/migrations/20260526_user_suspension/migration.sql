-- Super-admin account suspension (distinct from soft-delete).
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "suspendedReason" TEXT;
