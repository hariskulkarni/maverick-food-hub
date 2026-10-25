-- platform-auth r3: a SUPER_ADMIN-issued password must be changed at next login.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
