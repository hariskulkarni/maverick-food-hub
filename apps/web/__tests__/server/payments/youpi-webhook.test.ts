import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  reconcile: vi.fn(),
  evFind: vi.fn(),
  evCreate: vi.fn(),
  evUpdate: vi.fn(),
  payFind: vi.fn(),
  payUpdate: vi.fn(),
}));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/db', () => ({
  prisma: {
    paymentWebhookEvent: { findUnique: h.evFind, create: h.evCreate, update: h.evUpdate },
    payment: { findFirst: h.payFind, updateMany: h.payUpdate },
  },
}));

import { POST } from '@/app/api/payments/youpi/webhook/route';

const SECRET = 'whsec_test';
const sign = (raw: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const body = JSON.stringify({ event: 'payment.captured', orderId: 'ord_1', amount: 1, amountPaise: 100, utr: 'U1', paymentId: 'yp_1' });

function req(raw = body, o: { sig?: string; ts?: string; id?: string | null } = {}) {
  const headers: Record<string, string> = {
    'x-gateway-signature': o.sig ?? sign(raw),
    'x-gateway-timestamp': o.ts ?? String(Math.floor(Date.now() / 1000)),
  };
  if (o.id !== null) headers['x-gateway-delivery-id'] = o.id ?? 'd1';
  return new Request('http://x/api/payments/youpi/webhook', { method: 'POST', body: raw, headers }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getConfig.mockResolvedValue({ webhookSecret: SECRET });
  h.evFind.mockResolvedValue(null);
  h.evCreate.mockResolvedValue({ id: 'ev1' });
  h.evUpdate.mockResolvedValue({});
  h.payFind.mockResolvedValue({ id: 'pay_internal', orderId: 'ord_1' });
  h.payUpdate.mockResolvedValue({ count: 1 });
  h.reconcile.mockResolvedValue({ captured: true });
});

describe('POST /api/payments/youpi/webhook', () => {
  it('valid signature: reconciles the resolved payment, never trusting body status', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.getConfig).toHaveBeenCalledWith('__platform__', 'YOUPI');
    expect(h.payFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ providerRef: 'yp_1' }) }),
    );
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile).toHaveBeenCalledWith('pay_internal');
  });

  it('accepts a millisecond timestamp', async () => {
    const res = await POST(req(body, { ts: String(Date.now()) }));
    expect(res.status).toBe(200);
  });

  it('namespaces the dedup key as youpi:<deliveryId>', async () => {
    await POST(req(body, { id: 'abc' }));
    expect(h.evFind).toHaveBeenCalledWith({ where: { providerEventId: 'youpi:abc' } });
    expect(h.evCreate.mock.calls[0][0].data).toMatchObject({ provider: 'youpi', providerEventId: 'youpi:abc' });
  });

  it('stores the event before reconciling', async () => {
    await POST(req());
    expect(h.evCreate.mock.invocationCallOrder[0]).toBeLessThan(h.reconcile.mock.invocationCallOrder[0]);
  });

  it('tampered body: 401, no store, no reconcile', async () => {
    const sig = sign(body);
    const res = await POST(req(body.replace('"amountPaise":100', '"amountPaise":1'), { sig }));
    expect(res.status).toBe(401);
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('wrong-length / missing signature: 401', async () => {
    expect((await POST(req(body, { sig: 'abc' }))).status).toBe(401);
    expect((await POST(req(body, { sig: '' }))).status).toBe(401);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('missing secret: rejected, no reconcile', async () => {
    h.getConfig.mockResolvedValue({});
    const res = await POST(req());
    expect([401, 503]).toContain(res.status);
    expect(h.reconcile).not.toHaveBeenCalled();
    h.getConfig.mockResolvedValue(null);
    expect([401, 503]).toContain((await POST(req())).status);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('stale timestamp (>5min): 400, no reconcile', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const res = await POST(req(body, { ts: old }));
    expect(res.status).toBe(400);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('missing/invalid timestamp: 400', async () => {
    expect((await POST(req(body, { ts: 'garbage' }))).status).toBe(400);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('missing delivery id: 400, no reconcile', async () => {
    const res = await POST(req(body, { id: null }));
    expect(res.status).toBe(400);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('duplicate delivery (already stored): 200 no-op', async () => {
    h.evFind.mockResolvedValue({ id: 'ev0' });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('concurrent duplicate (P2002 on create): 200 no-op', async () => {
    h.evCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('recovers a signed webhook received before gateway paymentId was persisted', async () => {
    const attemptBody = JSON.stringify({
      event: 'SUCCESS', paymentId: 'yp_3', orderId: 'ord_1-2',
      amountPaise: 100, utr: '123456789012',
    });
    h.payFind.mockImplementation(async (opts: any) => opts.where?.providerRef === 'ord_1-2'
      ? { id: 'pay_internal', providerRef: 'ord_1-2', orderId: 'ord_1' }
      : null);
    const res = await POST(req(attemptBody, { id: 'fresh-2' }));
    expect(res.status).toBe(200);
    expect(h.payUpdate).toHaveBeenCalledWith({
      where: { id: 'pay_internal', providerName: 'youpi', providerRef: 'ord_1-2', status: 'PENDING' },
      data: { providerRef: 'yp_3' },
    });
    expect(h.reconcile).toHaveBeenCalledWith('pay_internal');
  });

  it('unknown payment: 200, no reconcile', async () => {
    h.payFind.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('reconcile error: still 200, error recorded on the event', async () => {
    h.reconcile.mockRejectedValue(new Error('boom'));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.evUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ev1' }, data: expect.objectContaining({ error: 'boom' }) }),
    );
  });
});
