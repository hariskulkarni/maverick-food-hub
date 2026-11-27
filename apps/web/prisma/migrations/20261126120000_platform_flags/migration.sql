-- Standalone platform flags (currently: maintenance / under-construction mode).
--
-- Intentionally dependency-free: no foreign keys, no enum, no encryption. The
-- maintenance switch is what you reach for during an incident, so writing it
-- must not require a SUPER_ADMIN row to exist or the sentinel "__platform__"
-- Restaurant to be bootstrapped (which is what the encrypted platform-config
-- blob needs).
--
-- Additive and idempotent: rollback is a plain DROP TABLE.

CREATE TABLE IF NOT EXISTS "PlatformFlag" (
  "key"       TEXT NOT NULL,
  "value"     JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformFlag_pkey" PRIMARY KEY ("key")
);
