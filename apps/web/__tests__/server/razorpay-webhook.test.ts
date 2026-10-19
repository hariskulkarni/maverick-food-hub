/**
 * H11 — the Razorpay event id comes from the x-razorpay-event-id HEADER, so
 * dedupe works and redeliveries become no-ops.
 * H12 — a partial refund must NOT mark the Payment REFUNDED (terminal); only a
 * refund that cumulatively covers the order total does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const SECRET = 'whsec_test';

let seenEvent: any = null;
let refundStatus: string | null = null;
let paymentStatus: string | null = null;
let orderTotal = 500;
let completedRefunds: { amount: number }[] = [];
const paymentUpdate = vi.fn();

vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ getConfig: async () => null }));
vi.mock('@/server/payments/webhook-events', () => ({
  refundStatusFromEvent: () => refundStatus,
  paymentStatusFromEvent: () => paymentStatus
}));
vi.mock('@/server/db', () => ({
  prisma: {
    paymentWebhookEvent: {
      findUnique: async () => seenEvent,
      create: async ({ data }: any) => ({ id: 'wh1', ...data }),
      update: async () => ({})
    },
    payment: {
      findFirst: async () => ({ id: 'pay1', orderId: 'ord1', providerData: {} }),
      update: async (a: any) => { paymentUpdate(a); return {}; }
    },
    refund: {
      findFirst: async () => ({ id: 'rf1', providerRef: 'rfnd_x', providerData: {} }),
      update: async () => ({}),
      findMany: async () => completedRefunds
    },
    order: { findUnique: async () => ({ total: orderTotal }) }
  }
}));

import { POST } from '@/app/api/payments/razorpay/webhook/route';

function post(body: object, eventId?: string) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const headers: Record<string, string> = { 'x-razorpay-signature': sig };
  if (eventId) headers['x-razorpay-event-id'] = eventId;
  return POST(new Request('http://x/webhook', { method: 'POST', headers, body: raw }) as any);
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  seenEvent = null; refundStatus = null; paymentStatus = null; orderTotal = 500; completedRefunds = [];
  paymentUpdate.mockReset();
});

describe('H11: webhook dedupe via x-razorpay-event-id header', () => {
  it('dedupes a redelivery carrying the same event id', async () => {
    const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'ord_x' } } } };
    const r1 = await post(body, 'evt_1');
    expect(r1.status).toBe(200);
    seenEvent = { id: 'wh1', providerEventId: 'evt_1' }; // now on record
    const r2 = await post(body, 'evt_1');
    const j2 = await r2.json();
    expect(j2.deduped).toBe(true);
  });
});

describe('H12: partial refund does not mark payment REFUNDED', () => {
  it('leaves payment CAPTURED on a partial refund', async () => {
    refundStatus = 'COMPLETED';
    completedRefunds = [{ amount: 50 }]; // of 500
    await post({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_x', payment_id: 'pay_x', status: 'processed' } } } }, 'evt_2');
    const refundedCalls = paymentUpdate.mock.calls.filter((c) => c[0]?.data?.status === 'REFUNDED');
    expect(refundedCalls.length).toBe(0);
  });

  it('marks payment REFUNDED once refunds cover the order total', async () => {
    refundStatus = 'COMPLETED';
    completedRefunds = [{ amount: 500 }];
    await post({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_x', payment_id: 'pay_x', status: 'processed' } } } }, 'evt_3');
    const refundedCalls = paymentUpdate.mock.calls.filter((c) => c[0]?.data?.status === 'REFUNDED');
    expect(refundedCalls.length).toBe(1);
  });
});
