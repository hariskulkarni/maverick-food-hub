/**
 * F9: overlap guard for scheduled jobs — a lease row with an expiry.
 *
 * Session-level pg advisory locks are unsafe through Prisma's connection pool:
 * the unlock can run on a different pooled connection (silently a no-op) and
 * the lock then stays held by the connection that took it, blocking every
 * later run. A lease row has no connection affinity, and a crashed run's
 * lease simply expires after `ttlMs`.
 *
 *   const lease = await acquireJobLease('my-sweep', 10 * 60_000);
 *   if (!lease) return;                 // another run holds it
 *   try { ... } finally { await releaseJobLease('my-sweep', lease); }
 *
 * Pick a ttl comfortably above the job's worst-case runtime.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

/** Returns a holder token when the lease was acquired, else null. */
export async function acquireJobLease(name: string, ttlMs: number): Promise<string | null> {
  const holder = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.jobLease.create({ data: { name, holder, expiresAt } });
    return holder;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
  }
  // Row exists: take it over only if it has expired (atomic conditional update).
  const taken = await prisma.jobLease.updateMany({
    where: { name, expiresAt: { lt: now } },
    data: { holder, expiresAt },
  });
  return taken.count === 1 ? holder : null;
}

/** Release our lease. A holder whose lease was taken over frees nothing. */
export async function releaseJobLease(name: string, holder: string): Promise<void> {
  await prisma.jobLease.deleteMany({ where: { name, holder } });
}
