-- Rider audit r3 (2026-10-25): count wrong delivery-OTP submissions per
-- assignment so the deliver route can lock hand-over after 5 attempts.
ALTER TABLE "RiderAssignment" ADD COLUMN "deliveryOtpAttempts" INTEGER NOT NULL DEFAULT 0;
