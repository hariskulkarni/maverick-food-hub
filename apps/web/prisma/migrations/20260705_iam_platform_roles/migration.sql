-- IAM: platform-team roles managed by SUPER_ADMIN via /platform/iam.
-- Adds four operator roles to the Role enum. Non-destructive: existing rows keep
-- their current role. NOTE: prod applies schema via `prisma db push` (see
-- scripts/deploy-remote.sh --migrate); this file documents the equivalent SQL.
-- `ADD VALUE` cannot run inside a txn on PG<12; PG12+ (our cluster) is fine.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN_ASSIST';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DEVELOPER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'QA';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GUEST';
