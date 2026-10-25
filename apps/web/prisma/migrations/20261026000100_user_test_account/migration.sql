-- Pre-launch test customer accounts (OTP shown on screen, never sent by SMS).
ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
