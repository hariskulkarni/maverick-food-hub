-- platform-auth r3: single-use Google Authenticator recovery codes (hashed).
CREATE TABLE IF NOT EXISTS "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TotpRecoveryCode_userId_idx" ON "TotpRecoveryCode"("userId");
