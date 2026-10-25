/**
 * P1-6 revenue include-list, P1-7 refunded cancellations, P1-8 IST buckets,
 * P1-12 bounded + streamed + formula-safe order export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  gate: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: { order: { findMany: h.findMany, count: h.count } } }));
vi.mock('@/server/reports/admin-branch', () => ({ requireAdminReportScope: async () => ({ restaurant: { id: 'A' }, branchIds: ['b1', 'b2'] }) }));
vi.mock('@/server/api-auth', () => ({ requireRestaurantAdminApi: h.gate }));

import { csvCell } from '@/server/reports/csv';
import { ordersCsvStream, EXPORT_BATCH } from '@/server/exports';
import { REVENUE_STATUSES } from '@/server/reports/revenue';
import { GET as dailySales } from '@/app/api/admin/reports/daily-sales/route';
import { GET as cancelled } from '@/app/api/admin/reports/cancelled-orders/route';
import { GET as ordersCsv } from '@/app/api/admin/reports/orders.csv/route';

const req = (url: string) => Object.assign(new Request(url), { nextUrl: new URL(url) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.gate.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
});

describe('csvCell', () => {
  it('neutralises formula injection but keeps numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 98')).toBe("'+91 98");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});

describe('revenue statuses', () => {
  it('include-list excludes pending, failed, cancelled, refunds', () => {
    for (const s of ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELLED', 'CANCELLED_BY_RESTAURANT', 'DELIVERY_FAILED', 'REFUND_PENDING', 'REFUNDED']) {
      expect(REVENUE_STATUSES).not.toContain(s);
    }
    expect(REVENUE_STATUSES).toContain('DELIVERED');
  });

  it('daily-sales filters on the include-list and buckets by IST day', async () => {
    h.findMany.mockResolvedValue([
      { placedAt: new Date('2026-10-24T19:00:00Z'), subtotal: 100, total: 110, taxAmount: 5, deliveryFee: 5 }, // 00:30 IST 25 Oct
    ]);
    const res = await dailySales(req('http://x/api/admin/reports/daily-sales?from=2026-10-25&to=2026-10-25'));
    expect(h.findMany.mock.calls[0][0].where.status).toEqual({ in: REVENUE_STATUSES });
    const body = await res.text();
    expect(body).toContain('2026-10-25,1,100.00');
  });
});

describe('cancelled-orders report', () => {
  it('matches cancellations by cancelledAt so refunded ones are included', async () => {
    h.findMany.mockResolvedValue([
      { code: 'C1', status: 'REFUNDED', cancelReason: null, cancellationReason: 'out of stock', customer: { name: 'A', phone: null }, refunds: [{ amount: 250 }] },
    ]);
    const res = await cancelled(req('http://x/api/admin/reports/cancelled-orders?from=2026-10-01&to=2026-10-25'));
    const where = h.findMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
    expect(where.OR[0]).toHaveProperty('cancelledAt');
    expect(await res.text()).toContain('C1,REFUNDED,A,out of stock,250.00');
  });
});

describe('orders.csv export', () => {
  const row = (i: number) => ({ id: `o${i}`, code: `=X${i}`, placedAt: new Date('2026-10-24T19:00:00Z'), status: 'DELIVERED', total: 10, paymentMethod: 'UPI', customer: { name: 'N', phone: null } });

  it('is range-bounded, batched with a cursor, and formula-safe', async () => {
    h.findMany
      .mockResolvedValueOnce(Array.from({ length: EXPORT_BATCH }, (_, i) => row(i)))
      .mockResolvedValueOnce([row(EXPORT_BATCH)]);
    const res = await ordersCsv(req('http://x/api/admin/reports/orders.csv?from=2026-10-01&to=2026-10-25'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim().split('\n')).toHaveLength(EXPORT_BATCH + 2);
    expect(text).toContain("'=X0");
    const first = h.findMany.mock.calls[0][0];
    expect(first.where.placedAt.gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(first.take).toBe(EXPORT_BATCH);
    expect(h.findMany.mock.calls[1][0].cursor).toEqual({ id: `o${EXPORT_BATCH - 1}` });
  });

  it('rejects an inverted range with 400', async () => {
    const res = await ordersCsv(req('http://x/api/admin/reports/orders.csv?from=2026-10-25&to=2026-10-01'));
    expect(res.status).toBe(400);
  });

  it('stream helper ends cleanly when there are no orders', async () => {
    h.findMany.mockResolvedValueOnce([]);
    const text = await new Response(ordersCsvStream(['b1'], { from: new Date(0), to: new Date() })).text();
    expect(text.trim()).toBe('﻿code,placed_at_ist,status,customer,total,payment_method'.trim());
  });
});
