/**
 * H15 — the reconcile sweep takes a job lease (overlap guard; F9 replaced the
 * session advisory lock) and surfaces
 * an `abandoned` count for rows older than MAX_AGE instead of silently stranding
 * them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  payment: { findMany: vi.fn(), count: vi.fn() },
  refund: { findMany: vi.fn() },
}));
const lease = vi.hoisted(() => ({ acquireJobLease: vi.fn(async (): Promise<string | null> => 'tok1'), releaseJobLease: vi.fn(async () => {}) }));
vi.mock('@/server/jobs/lease', () => lease);
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
  lease.acquireJobLease.mockResolvedValue('tok1');
});

describe('H15: reconcile sweep overlap guard + abandon count', () => {
  it('skips (no scan) when the job lease is held by another run', async () => {
    lease.acquireJobLease.mockResolvedValueOnce(null);
    const r = await runPhonePeReconcileSweep();
    expect(db.payment.findMany).not.toHaveBeenCalled();
    expect(r.paymentsScanned).toBe(0);
  });

  it('runs and releases its own lease when acquired (F9: no advisory lock)', async () => {
    await runPhonePeReconcileSweep();
    expect(db.payment.findMany).toHaveBeenCalled();
    expect(lease.acquireJobLease).toHaveBeenCalledWith('phonepe-reconcile-sweep', expect.any(Number));
    expect(lease.releaseJobLease).toHaveBeenCalledWith('phonepe-reconcile-sweep', 'tok1');
  });

  it('reports + warns on abandoned (older-than-MAX_AGE) rows', async () => {
    db.payment.count.mockResolvedValue(7);
    const r = await runPhonePeReconcileSweep();
    expect(r.abandoned).toBe(7);
    expect(warn).toHaveBeenCalled();
  });
});
