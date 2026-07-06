-- Stage 3 IAM: maker-checker approvals. New enum + table; non-destructive.
-- Prod applies via `prisma db push` (scripts/deploy-remote.sh --migrate).
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ApprovalRequest" (
  "id"             TEXT NOT NULL,
  "action"         TEXT NOT NULL,
  "capability"     TEXT NOT NULL,
  "status"         "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "summary"        TEXT NOT NULL,
  "resourceType"   TEXT,
  "resourceId"     TEXT,
  "payload"        JSONB NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "reviewNote"     TEXT,
  "executedAt"     TIMESTAMP(3),
  "executionError" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
