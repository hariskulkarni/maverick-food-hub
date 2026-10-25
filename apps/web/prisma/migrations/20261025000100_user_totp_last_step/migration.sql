-- F15 (platform-auth r3): TOTP replay guard. Absolute 30s step of the last
-- Google Authenticator code accepted at login; a code must match a newer step.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpLastStep" INTEGER;
