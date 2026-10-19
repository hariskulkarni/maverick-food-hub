/**
 * C7 — one order must not be captured twice. When a second PhonePe payment on an
 * order reports CAPTURED but the order already has a captured payment, the
 * reconciler must NOT capture it: it flags an over-collection and leaves the row
 * uncaptured for a refund.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db: any = vi.hoisted(() => ({
  payment: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  refund: { findMany: vi.fn(), update: vi.fn() },
  order: { findUnique: vi.fn() },
  codCollection: { findUnique: vi.fn(), update: vi.fn() },
}));
const orders = vi.hoisted(() => ({ maybeAutoAccept: vi.fn().mockResolvedValue(undefined), transitionOrder: vi.fn().mockResolvedValue({}) }));
const api = vi.hoisted(() => ({ getOrderStatus: vi.fn(), getRefundStatus: vi.fn() }));
const phonepe = vi.hoisted(() => ({ resolvePhonePeConfig: vi.fn() }));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/orders', () => orders);
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/payments/phonepe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/payments/phonepe-api')>();
  return { ...actual, ...api };
});
vi.mock('@/server/payments/phonepe', () => phonepe);

import { reconcilePhonePePayment } from '@/server/payments/reconcile';

beforeEach(() => {
  vi.clearAllMocks();
  phonepe.resolvePhonePeConfig.mockResolvedValue({ clientId: 'A', clientSecret: 'B', clientVersion: '1', env: 'SANDBOX' });
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.payment.findUnique.mockResolvedValue({
    id: 'pay_2', orderId: 'ord_1', status: 'PENDING', providerRef: 'ord_1-2', providerName: 'phonepe',
    providerData: {}, order: { id: 'ord_1', status: 'RECEIVED', branch: { restaurantId: 'rest_1' } },
  });
  api.getOrderStatus.mockResolvedValue({ orderId: 'OMO2', state: 'COMPLETED', amount: 49950, paymentDetails: [], raw: {} });
});

describe('C7: reconciler refuses a second capture on an already-paid order', () => {
  it('does not capture when the order already has a captured payment', async () => {
    db.payment.findFirst.mockResolvedValue({ id: 'pay_1' }); // a sibling already CAPTURED
    const res = await reconcilePhonePePayment('pay_2');
    expect(res.captured).toBe(false);
    const call = db.payment.updateMany.mock.calls[0][0];
    expect(call.data.status).toBeUndefined(); // never set to CAPTURED
    expect(call.data.providerData._overCollection).toBe(true);
  });

  it('captures normally when no sibling is captured', async () => {
    db.payment.findFirst.mockResolvedValue(null);
    const res = await reconcilePhonePePayment('pay_2');
    expect(res.captured).toBe(true);
    expect(db.payment.updateMany.mock.calls[0][0].data.status).toBe('CAPTURED');
  });
});
