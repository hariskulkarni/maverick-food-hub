-- Customer onboarding: Google sign-in + mandatory phone OTP (additive only).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "favoriteCuisines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- Backfill: until now a CUSTOMER could only acquire a phone number by logging
-- in with a phone OTP (Google sign-up creates phone-less accounts; profile edit
-- never changed the phone), so every existing customer phone is OTP-proven.
UPDATE "User" SET "phoneVerifiedAt" = "createdAt"
WHERE "role" = 'CUSTOMER' AND "phone" IS NOT NULL AND "phoneVerifiedAt" IS NULL;

-- Existing accounts are not sent through the new welcome onboarding.
UPDATE "User" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
