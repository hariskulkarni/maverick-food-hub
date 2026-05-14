import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    order: { findMany: vi.fn() },
    orderEscalation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    deliveryLocationPing: { findFirst: vi.fn() }
  } as any
}));

vi.mock('@/server/db', () => ({ prisma: prismaMock }));

import { runEscalationScan, resolveOrderEscalations } from '@/server/escalations';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing to escalate
  prismaMock.order.findMany.mockResolvedValue([]);
  prismaMock.orderEscalation.findFirst.mockResolvedValue(null);
  prismaMock.orderEscalation.create.mockImplementation(async ({ data }: any) => ({
    id: 'esc-' + Math.random().toString(36).slice(2, 7),
    ...data,
    status: 'OPEN',
    createdAt: new Date()
  }));
  prismaMock.orderEscalation.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.deliveryLocationPing.findFirst.mockResolvedValue(null);
});

describe('escalations — idempotency', () => {
  it('does not create a second OPEN escalation for the same (orderId, type)', async () => {
    const staleOrder = {
      id: 'order-1',
      code: 'ORD-AAA',
      placedAt: new Date(Date.now() - 30 * 60_000) // 30 minutes ago
    };
    // First scan: PAYMENT_PENDING returns one stale order, no existing escalation → create.
    prismaMock.order.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.status === 'PAYMENT_PENDING') return [staleOrder];
      return [];
    });

    const first = await runEscalationScan();
    expect(prismaMock.orderEscalation.create).toHaveBeenCalledTimes(1);
    expect(first.created).toBeGreaterThanOrEqual(1);

    // Second scan: an OPEN escalation now exists for that (order, type).
    // Use a createdAt safely older than the "<5s ago" heuristic the scanner
    // uses to decide whether to count a row as "new this run", so we test the
    // contract we care about: no INSERT.
    const oldCreated = new Date(Date.now() - 10 * 60_000);
    prismaMock.orderEscalation.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.orderId === staleOrder.id && args?.where?.type === 'PAYMENT_WEBHOOK_DELAY') {
        return { id: 'esc-existing', orderId: staleOrder.id, type: 'PAYMENT_WEBHOOK_DELAY', status: 'OPEN', createdAt: oldCreated };
      }
      return null;
    });
    prismaMock.orderEscalation.create.mockClear();

    await runEscalationScan();
    // The critical idempotency invariant: no new row inserted on the second run.
    expect(prismaMock.orderEscalation.create).not.toHaveBeenCalled();
  });
});

describe('escalations — resolve', () => {
  it('marks open escalations for an order as RESOLVED', async () => {
    await resolveOrderEscalations('order-1', 'admin-42');
    expect(prismaMock.orderEscalation.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: 'OPEN' },
      data: expect.objectContaining({ status: 'RESOLVED', resolvedBy: 'admin-42' })
    });
  });
});
