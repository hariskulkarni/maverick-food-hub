-- Observability Center (feat/observability). ADDITIVE ONLY.
--
-- ObsErrorLog / ObsProbe / ObsProbeEvent already exist in production (they were
-- applied with `prisma db push` and never got a migration), so they are created
-- here with IF NOT EXISTS — a no-op on prod, a correct bootstrap on a fresh DB.
-- Then four nullable/defaulted columns are added to ObsErrorLog and five new
-- bounded tables are created. Nothing is dropped, renamed or rewritten.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsErrorLog" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'ERROR',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "digest" TEXT,
    "sampleStack" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ObsErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsProbe" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "detail" TEXT,
    "meta" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObsProbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsProbeEvent" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObsProbeEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable (new ObsErrorLog columns)
ALTER TABLE "ObsErrorLog" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE "ObsErrorLog" ADD COLUMN IF NOT EXISTS "route" TEXT;
ALTER TABLE "ObsErrorLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "ObsErrorLog" ADD COLUMN IF NOT EXISTS "release" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsRequestMinute" (
    "minute" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'API',
    "count" INTEGER NOT NULL DEFAULT 0,
    "s2xx" INTEGER NOT NULL DEFAULT 0,
    "s3xx" INTEGER NOT NULL DEFAULT 0,
    "s4xx" INTEGER NOT NULL DEFAULT 0,
    "s5xx" INTEGER NOT NULL DEFAULT 0,
    "s401" INTEGER NOT NULL DEFAULT 0,
    "s403" INTEGER NOT NULL DEFAULT 0,
    "s429" INTEGER NOT NULL DEFAULT 0,
    "durSumMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durMaxMs" INTEGER NOT NULL DEFAULT 0,
    "hist" INTEGER[],

    CONSTRAINT "ObsRequestMinute_pkey" PRIMARY KEY ("minute","method","route")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsEventMinute" (
    "minute" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "dim1" TEXT NOT NULL DEFAULT '',
    "dim2" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObsEventMinute_pkey" PRIMARY KEY ("minute","kind","dim1","dim2")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsJobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'CRON',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "httpStatus" INTEGER,
    "summary" TEXT,
    "error" TEXT,
    "requestId" TEXT,

    CONSTRAINT "ObsJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsAlert" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'FIRING',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "firstFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifyCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObsAlertMute" (
    "key" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObsAlertMute_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ObsErrorLog_fingerprint_key" ON "ObsErrorLog"("fingerprint");
CREATE INDEX IF NOT EXISTS "ObsErrorLog_lastSeenAt_idx" ON "ObsErrorLog"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "ObsErrorLog_level_idx" ON "ObsErrorLog"("level");
CREATE INDEX IF NOT EXISTS "ObsErrorLog_resolvedAt_idx" ON "ObsErrorLog"("resolvedAt");
CREATE INDEX IF NOT EXISTS "ObsErrorLog_kind_lastSeenAt_idx" ON "ObsErrorLog"("kind", "lastSeenAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ObsProbe_target_key" ON "ObsProbe"("target");
CREATE INDEX IF NOT EXISTS "ObsProbe_category_idx" ON "ObsProbe"("category");
CREATE INDEX IF NOT EXISTS "ObsProbe_status_idx" ON "ObsProbe"("status");
CREATE INDEX IF NOT EXISTS "ObsProbeEvent_target_at_idx" ON "ObsProbeEvent"("target", "at");
CREATE INDEX IF NOT EXISTS "ObsProbeEvent_at_idx" ON "ObsProbeEvent"("at");
CREATE INDEX IF NOT EXISTS "ObsRequestMinute_minute_idx" ON "ObsRequestMinute"("minute");
CREATE INDEX IF NOT EXISTS "ObsRequestMinute_route_minute_idx" ON "ObsRequestMinute"("route", "minute");
CREATE INDEX IF NOT EXISTS "ObsEventMinute_kind_minute_idx" ON "ObsEventMinute"("kind", "minute");
CREATE INDEX IF NOT EXISTS "ObsJobRun_job_startedAt_idx" ON "ObsJobRun"("job", "startedAt");
CREATE INDEX IF NOT EXISTS "ObsJobRun_startedAt_idx" ON "ObsJobRun"("startedAt");
CREATE INDEX IF NOT EXISTS "ObsJobRun_status_idx" ON "ObsJobRun"("status");
CREATE INDEX IF NOT EXISTS "ObsAlert_state_lastSeenAt_idx" ON "ObsAlert"("state", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "ObsAlert_ruleKey_state_idx" ON "ObsAlert"("ruleKey", "state");
CREATE INDEX IF NOT EXISTS "ObsAlert_firstFiredAt_idx" ON "ObsAlert"("firstFiredAt");
