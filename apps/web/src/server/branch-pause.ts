/**
 * Branch-pause helpers — no schema change.
 *
 * Pause state is implemented by:
 *   1. Flipping Branch.isActive = false (existing column).
 *   2. Recording a sidecar Job row of type 'BRANCH_PAUSE' whose `runAt` is the
 *      auto-unpause time and whose `payload` carries { branchId, reason }.
 *
 * "Until I resume" pauses are stored with runAt set far in the future
 * (year 9999). `sweepExpiredPauses()` periodically promotes expired pauses
 * back to active.
 */
import { prisma } from './db';

export const BRANCH_PAUSE = 'BRANCH_PAUSE';

// JobStatus literals — kept inline so this file compiles even when the local
// generated Prisma client is stale relative to the schema.
const JobStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
} as const;

// The Job model lives in schema.prisma. Narrowed via a cast because we must
// not modify the schema in this branch.
type JobRow = {
  id: string;
  type: string;
  payload: unknown;
  status: keyof typeof JobStatus;
  runAt: Date;
  createdAt: Date;
};
type JobDelegate = {
  create: (args: any) => Promise<JobRow>;
  findMany: (args: any) => Promise<JobRow[]>;
  findFirst: (args: any) => Promise<JobRow | null>;
  update: (args: any) => Promise<JobRow>;
  updateMany: (args: any) => Promise<{ count: number }>;
};
const jobs = (prisma as unknown as { job: JobDelegate }).job;

// Sentinel used for "until manually resumed" pauses.
const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z');

function branchIdFilter(branchId: string) {
  return {
    type: BRANCH_PAUSE,
    status: JobStatus.PENDING,
    payload: { path: ['branchId'], equals: branchId }
  };
}

export async function pauseBranch(branchId: string, minutes: number | null, reason?: string) {
  const runAt = minutes == null ? FAR_FUTURE : new Date(Date.now() + minutes * 60_000);

  // Cancel any older pending pause jobs for this branch — only one active at a time.
  await jobs.updateMany({
    where: branchIdFilter(branchId),
    data: { status: JobStatus.CANCELLED }
  });

  const created = await jobs.create({
    data: {
      type: BRANCH_PAUSE,
      status: JobStatus.PENDING,
      runAt,
      payload: { branchId, reason: reason ?? null, indefinite: minutes == null }
    }
  });

  await prisma.branch.update({ where: { id: branchId }, data: { isActive: false } });

  return created;
}

export async function unpauseBranch(branchId: string) {
  await jobs.updateMany({
    where: branchIdFilter(branchId),
    data: { status: JobStatus.CANCELLED }
  });
  await prisma.branch.update({ where: { id: branchId }, data: { isActive: true } });
}

export async function isPaused(branchId: string): Promise<{ paused: boolean; reason?: string; until?: Date; indefinite?: boolean }> {
  const job = await jobs.findFirst({
    where: {
      ...branchIdFilter(branchId),
      runAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!job) return { paused: false };

  const payload = (job.payload ?? {}) as { reason?: string | null; indefinite?: boolean };
  const indefinite = !!payload.indefinite || job.runAt.getTime() === FAR_FUTURE.getTime();

  return {
    paused: true,
    reason: payload.reason ?? undefined,
    until: indefinite ? undefined : job.runAt,
    indefinite
  };
}

/**
 * Background sweep. Call from a cron / job runner.
 * Any pending BRANCH_PAUSE job whose runAt has passed flips its branch back on.
 */
export async function sweepExpiredPauses() {
  const expired = await jobs.findMany({
    where: { type: BRANCH_PAUSE, status: JobStatus.PENDING, runAt: { lte: new Date() } }
  });

  for (const j of expired) {
    const { branchId } = (j.payload ?? {}) as { branchId?: string };
    if (!branchId) {
      await jobs.update({ where: { id: j.id }, data: { status: JobStatus.FAILED, lastError: 'Missing branchId in payload' } });
      continue;
    }
    await prisma.branch.update({ where: { id: branchId }, data: { isActive: true } });
    await jobs.update({ where: { id: j.id }, data: { status: JobStatus.COMPLETED } });
  }

  return { processed: expired.length };
}
