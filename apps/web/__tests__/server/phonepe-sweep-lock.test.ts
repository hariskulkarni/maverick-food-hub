/**
 * H15 — the reconcile sweep takes an advisory lock (overlap guard) and surfaces
 * an `abandoned` count for rows older than MAX_AGE instead of silently stranding
 * them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  payment: { findMany: vi.fn(), count: vi.fn() },
  refund: { findMany: vi.fn() },
  $queryRaw: vi.fn()
}));
const warn = vi.hoisted(() => vi.fn());

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn, error: vi.fn() } }));
vi.mock('@/server/payments/reconcile', () => ({
  reconcilePhonePePayment: vi.fn(), reconcilePhonePeRefund: vi.fn(), markOrderPaymentFailed: vi.fn()
}));

import { runPhonePeReconcileSweep } from '@/server/jobs/phonepe-reconcile-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  db.payment.findMany.mockResolvedValue([]);
  db.refund.findMany.mockResolvedValue([]);
  db.payment.count.mockResolvedValue(0);
  db.$queryRaw.mockResolvedValue([{ locked: true }]);
});

describe('H15: reconcile sweep overlap guard + abandon count', () => {
  it('skips (no scan) when the advisory lock is not acquired', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    const r = await runPhonePeReconcileSweep();
    expect(db.payment.findMany).not.toHaveBeenCalled();
    expect(r.paymentsScanned).toBe(0);
  });

  it('runs and releases the lock when acquired', async () => {
    await runPhonePeReconcileSweep();
    expect(db.payment.findMany).toHaveBeenCalled();
    // lock acquire + unlock → $queryRaw called at least twice
    expect(db.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reports + warns on abandoned (older-than-MAX_AGE) rows', async () => {
    db.payment.count.mockResolvedValue(7);
    const r = await runPhonePeReconcileSweep();
    expect(r.abandoned).toBe(7);
    expect(warn).toHaveBeenCalled();
  });
});
