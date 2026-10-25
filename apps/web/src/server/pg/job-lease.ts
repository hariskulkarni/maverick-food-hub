/**
 * Cron/worker mutual exclusion via a PgJobLease row (contract D11).
 *
 * Replaces session advisory locks: with a pooled Prisma client the
 * pg_advisory_unlock can run on a different pooled session than the lock, so
 * the lock leaks (or a second runner gets in). A lease row with an expiry is
 * session-independent and self-heals after a crash once it expires.
 *
 * Also hosts the small helpers shared by the inbox/outbox lease queues.
 *
 * Raw SQL in pg/* uses timezone('utc', now()): Prisma DateTime columns are
 * `timestamp without time zone` holding UTC, and a bare now() would be
 * compared/stored in the session TimeZone (wrong by hours on a non-UTC server).
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { log } from '../log';

export function newLeaseOwner(prefix: string): string {
  return `${prefix}:${os.hostname()}:${process.pid}:${randomUUID()}`;
}

/**
 * Bounded exponential backoff with +/-20% jitter for retry number `attempts` (1-based):
 * 30s, 60s, 2m, 4m ... capped at 1h.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Atomically takes the lease if it is free or expired. Returns true when `owner` now holds it. */
export async function acquireJobLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ owner: string }[]>`
    INSERT INTO "PgJobLease" ("name", "owner", "expiresAt", "updatedAt")
    VALUES (${name}, ${owner}, timezone('utc', now()) + ${ttlMs}::int * interval '1 millisecond', timezone('utc', now()))
    ON CONFLICT ("name") DO UPDATE
      SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = timezone('utc', now())
      WHERE "PgJobLease"."expiresAt" < timezone('utc', now())
    RETURNING "owner"`;
  return rows.length === 1 && rows[0].owner === owner;
}

/** Extends the lease only while `owner` still holds it. */
export async function renewJobLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE "PgJobLease" SET "expiresAt" = timezone('utc', now()) + ${ttlMs}::int * interval '1 millisecond', "updatedAt" = timezone('utc', now())
    WHERE "name" = ${name} AND "owner" = ${owner}`;
  return n === 1;
}

export async function releaseJobLease(name: string, owner: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "PgJobLease" WHERE "name" = ${name} AND "owner" = ${owner}`;
}

export type JobLeaseResult<T> = { acquired: true; result: T } | { acquired: false };

/**
 * Runs `fn` only if this process wins the named lease. The lease is renewed
 * every ttl/3 while `fn` runs (heartbeat) and released afterwards. Choose
 * `ttlMs` well above a heartbeat interval; if the process dies the lease
 * simply expires.
 */
export async function withJobLease<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<JobLeaseResult<T>> {
  const owner = newLeaseOwner(name);
  if (!(await acquireJobLease(name, owner, ttlMs))) return { acquired: false };
  const beat = setInterval(() => {
    renewJobLease(name, owner, ttlMs)
      .then((held) => { if (!held) log.error({ name }, 'pg.job_lease.lost'); })
      .catch((e) => log.error({ name, err: (e as Error).message }, 'pg.job_lease.renew_failed'));
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  beat.unref?.();
  try {
    return { acquired: true, result: await fn() };
  } finally {
    clearInterval(beat);
    await releaseJobLease(name, owner).catch((e) =>
      log.error({ name, err: (e as Error).message }, 'pg.job_lease.release_failed'),
    );
  }
}
