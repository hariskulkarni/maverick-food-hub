import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: { payment: { findMany: vi.fn(), count: vi.fn() }, $queryRaw: vi.fn() } as any,
  reconcile: vi.fn(),
  lease: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));
vi.mock('@/server/payments/youpi', () => ({ YOUPI_PROVIDER_NAME: 'youpi' }));
vi.mock('@/server/pg/job-lease', () => ({ withJobLease: h.lease }));

import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  h.lease.mockImplementation(async (_n: string, _ms: number, fn: () => Promise<unknown>) => ({ acquired: true, result: await fn() }));
  h.db.payment.findMany.mockResolvedValue([]);
  h.db.payment.count.mockResolvedValue(0);
});

describe('runYoupiReconcileSweep', () => {
  it('skips scan when the PgJobLease is held elsewhere', async () => {
    h.lease.mockResolvedValueOnce({ acquired: false });
    const r = await runYoupiReconcileSweep();
    expect(h.db.payment.findMany).not.toHaveBeenCalled();
    expect(r).toEqual({ scanned: 0, reconciled: 0, captured: 0, failed: 0, abandoned: 0 });
  });

  it('one payment throwing does not abort; counts outcomes; runs under the job lease (no advisory lock)', async () => {
    h.db.payment.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]).mockResolvedValueOnce([]);
    h.db.payment.count.mockResolvedValue(2);
    h.reconcile
      .mockResolvedValueOnce({ status: 'CAPTURED' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'FAILED' })
      .mockResolvedValueOnce({ status: 'PENDING' });
    const r = await runYoupiReconcileSweep();
    expect(r).toEqual({ scanned: 4, reconciled: 3, captured: 1, failed: 1, abandoned: 2 });
    expect(h.db.$queryRaw).not.toHaveBeenCalled();
    expect(h.lease).toHaveBeenCalledWith('youpi-reconcile-sweep', expect.any(Number), expect.any(Function));
    const where = h.db.payment.findMany.mock.calls[0][0].where;
    expect(where.providerName).toBe('youpi');
    expect(where.status.in).toEqual(['PENDING', 'AUTHORIZED']);
  });
});
