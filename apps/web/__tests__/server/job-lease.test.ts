/**
 * F9 — sweep overlap guard as a lease row with expiry (no session advisory lock
 * on a pooled connection, which could stay held by a reused connection). A
 * crashed run's lease simply expires; release only frees our own lease.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = { name: string; holder: string; expiresAt: Date };
const rows = new Map<string, Row>();
const db = vi.hoisted(() => ({ jobLease: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: db }));

import { acquireJobLease, releaseJobLease } from '@/server/jobs/lease';

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  db.jobLease.create.mockImplementation(async ({ data }: any) => {
    if (rows.has(data.name)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    rows.set(data.name, { ...data });
    return data;
  });
  db.jobLease.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = rows.get(where.name);
    if (!r || !(r.expiresAt < where.expiresAt.lt)) return { count: 0 };
    rows.set(where.name, { ...r, ...data });
    return { count: 1 };
  });
  db.jobLease.deleteMany.mockImplementation(async ({ where }: any) => {
    const r = rows.get(where.name);
    if (r && r.holder === where.holder) { rows.delete(where.name); return { count: 1 }; }
    return { count: 0 };
  });
});

describe('F9: job lease', () => {
  it('first caller acquires, a concurrent caller is refused', async () => {
    const a = await acquireJobLease('sweep', 60_000);
    expect(a).toBeTruthy();
    expect(await acquireJobLease('sweep', 60_000)).toBeNull();
  });
  it('release frees the lease for the next run', async () => {
    const a = await acquireJobLease('sweep', 60_000);
    await releaseJobLease('sweep', a!);
    expect(await acquireJobLease('sweep', 60_000)).toBeTruthy();
  });
  it('an expired lease (crashed run) can be taken over', async () => {
    await acquireJobLease('sweep', 60_000);
    rows.get('sweep')!.expiresAt = new Date(Date.now() - 1000);
    expect(await acquireJobLease('sweep', 60_000)).toBeTruthy();
  });
  it('a stale holder cannot release a lease that was taken over', async () => {
    const old = await acquireJobLease('sweep', 60_000);
    rows.get('sweep')!.expiresAt = new Date(Date.now() - 1000);
    const fresh = await acquireJobLease('sweep', 60_000);
    await releaseJobLease('sweep', old!);
    expect(rows.get('sweep')?.holder).toBe(fresh);
  });
});
