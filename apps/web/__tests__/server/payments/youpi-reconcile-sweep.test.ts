import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: { payment: { findMany: vi.fn(), count: vi.fn() }, $queryRaw: vi.fn() } as any,
  reconcile: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));
vi.mock('@/server/payments/youpi', () => ({ YOUPI_PROVIDER_NAME: 'youpi' }));

import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$queryRaw.mockResolvedValue([{ locked: true }]);
  h.db.payment.findMany.mockResolvedValue([]);
  h.db.payment.count.mockResolvedValue(0);
});

describe('runYoupiReconcileSweep', () => {
  it('skips scan when advisory lock not acquired', async () => {
    h.db.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    const r = await runYoupiReconcileSweep();
    expect(h.db.payment.findMany).not.toHaveBeenCalled();
    expect(r).toEqual({ scanned: 0, reconciled: 0, captured: 0, failed: 0, abandoned: 0 });
  });

  it('one payment throwing does not abort; counts outcomes; releases lock', async () => {
    h.db.payment.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    h.db.payment.count.mockResolvedValue(2);
    h.reconcile
      .mockResolvedValueOnce({ status: 'CAPTURED' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'FAILED' })
      .mockResolvedValueOnce({ status: 'PENDING' });
    const r = await runYoupiReconcileSweep();
    expect(r).toEqual({ scanned: 4, reconciled: 3, captured: 1, failed: 1, abandoned: 2 });
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(2); // lock + unlock
    const where = h.db.payment.findMany.mock.calls[0][0].where;
    expect(where.providerName).toBe('youpi');
    expect(where.status.in).toEqual(['PENDING', 'AUTHORIZED']);
  });
});
