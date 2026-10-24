import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  attemptFind: vi.fn(),
  evFind: vi.fn(),
  evCreate: vi.fn(),
  processNow: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));
vi.mock('@/server/pg/inbox', () => ({ processInboxEventNow: h.processNow }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/db', () => ({
  prisma: {
    pgPaymentAttempt: { findFirst: h.attemptFind },
    paymentWebhookEvent: { findUnique: h.evFind, create: h.evCreate },
  },
}));

import { POST } from '@/app/api/payments/youpi/webhook/route';

const PLATFORM = 'platform_fake_secret';
const MERCHANT = 'merchant_fake_secret';
const nowSec = () => Math.floor(Date.now() / 1000);

// Fork / webhooks-v2 legacy-format body + Standard Webhooks headers.
const flat = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ event: 'SUCCESS', paymentId: 'yp_1', orderId: 'ord_1-a', amountPaise: 100, utr: 'U1', ...o });

function swHeaders(raw: string, secret = PLATFORM, o: { id?: string; ts?: number; xid?: string; event?: string } = {}) {
  const id = o.id ?? 'evt_1';
  const ts = o.ts ?? nowSec();
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${sig}`,
    'x-gateway-delivery-id': o.xid ?? id,
    'x-gateway-timestamp': String(ts * 1000),
    'x-gateway-event': o.event ?? 'SUCCESS',
    'x-gateway-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`,
  };
}

// Upstream d7b0741 format: deliveryId/timestamp repeated in the signed body, V2 signature.
function upstream(o: { tsMs?: number; id?: string; bodyId?: string; secret?: string } = {}) {
  const ts = String(o.tsMs ?? Date.now());
  const id = o.id ?? 'dlv-1';
  const raw = JSON.stringify({ event: 'SUCCESS', deliveryId: o.bodyId ?? id, timestamp: Number(ts), paymentId: 'yp_1', orderId: 'ord_1-a', amountPaise: 100, utr: 'U1' });
  const secret = o.secret ?? PLATFORM;
  const headers = {
    'x-gateway-event': 'SUCCESS',
    'x-gateway-delivery-id': id,
    'x-gateway-timestamp': ts,
    'x-gateway-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`,
    'x-gateway-signature-v2': `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`,
  };
  return { raw, headers };
}

const req = (raw: string | ReadableStream, headers: Record<string, string>) =>
  new Request('http://x/api/payments/youpi/webhook', { method: 'POST', body: raw, headers, duplex: 'half' } as RequestInit) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.getConfig.mockImplementation(async (rid: string) =>
    rid === '__platform__' ? { webhookSecret: PLATFORM, merchantId: 'M_PLATFORM' } : null);
  h.attemptFind.mockResolvedValue(null);
  h.evFind.mockResolvedValue(null);
  h.evCreate.mockResolvedValue({ id: 'ev1' });
  h.processNow.mockResolvedValue('processed');
});

describe('POST /api/payments/youpi/webhook — authentication', () => {
  it('Standard Webhooks signature: stores durably, 200, hands off to inbox; never reconciles from the body', async () => {
    const raw = flat();
    const res = await POST(req(raw, swHeaders(raw)));
    expect(res.status).toBe(200);
    const data = h.evCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ provider: 'youpi', providerEventId: 'youpi:evt_1', paymentId: 'yp_1', orderId: 'ord_1-a', processed: false });
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
    expect(h.processNow).toHaveBeenCalledWith('ev1');
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('upstream X-Gateway-Signature-V2: 200 with deliveryId from header==body', async () => {
    const { raw, headers } = upstream();
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(h.evCreate.mock.calls[0][0].data.providerEventId).toBe('youpi:dlv-1');
  });

  it('body-only legacy X-Gateway-Signature is rejected (timestamp not authenticated)', async () => {
    const raw = flat();
    const all = swHeaders(raw);
    const res = await POST(req(raw, {
      'x-gateway-signature': all['x-gateway-signature'],
      'x-gateway-delivery-id': 'evt_1',
      'x-gateway-timestamp': String(Date.now()),
    }));
    expect(res.status).toBe(401);
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('tampered body or wrong secret: 401, nothing stored', async () => {
    const raw = flat();
    const headers = swHeaders(raw);
    expect((await POST(req(flat({ amountPaise: 1 }), headers))).status).toBe(401);
    expect((await POST(req(raw, swHeaders(raw, 'wrong_fake_secret')))).status).toBe(401);
    const up = upstream({ secret: 'wrong_fake_secret' });
    expect((await POST(req(up.raw, up.headers))).status).toBe(401);
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('timestamp is bound into the MAC: re-dated replay with the old signature fails', async () => {
    const raw = flat();
    const headers = swHeaders(raw, PLATFORM, { ts: nowSec() - 3600 });
    const res = await POST(req(raw, { ...headers, 'webhook-timestamp': String(nowSec()) }));
    expect(res.status).toBe(401);
  });

  it('whsec_ (base64 key) secrets are supported', async () => {
    const whsec = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`;
    h.getConfig.mockImplementation(async (rid: string) => (rid === '__platform__' ? { webhookSecret: whsec } : null));
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw, whsec)))).status).toBe(200);
  });

  it('no secret configured: 503 so the gateway retries, nothing stored', async () => {
    h.getConfig.mockResolvedValue(null);
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw)))).status).toBe(503);
    expect(h.evCreate).not.toHaveBeenCalled();
  });
});

describe('per-merchant secrets and rotation', () => {
  beforeEach(() => {
    h.attemptFind.mockResolvedValue({ restaurantId: 'r1', gatewayMerchantId: 'M_R1' });
  });

  it('resolves the binding from the signed body identity and uses the restaurant secret', async () => {
    h.getConfig.mockImplementation(async (rid: string) =>
      rid === 'r1' ? { webhookSecret: MERCHANT } : { webhookSecret: PLATFORM, merchantId: 'M_PLATFORM' });
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw, MERCHANT)))).status).toBe(200);
    expect(h.attemptFind.mock.calls[0][0].where.OR).toEqual([{ attemptKey: 'ord_1-a' }, { gatewayPaymentId: 'yp_1' }]);
    expect(h.evCreate.mock.calls[0][0].data.restaurantId).toBe('r1');
  });

  it('platform secret is NOT accepted for an attempt bound to another merchant', async () => {
    h.getConfig.mockImplementation(async (rid: string) =>
      rid === 'r1' ? { webhookSecret: MERCHANT } : { webhookSecret: PLATFORM, merchantId: 'M_PLATFORM' });
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw, PLATFORM)))).status).toBe(401);
    // Binding has no secret of its own and is not on the platform merchant: no candidate secret at all.
    h.getConfig.mockImplementation(async (rid: string) => (rid === 'r1' ? null : { webhookSecret: PLATFORM, merchantId: 'M_PLATFORM' }));
    expect((await POST(req(raw, swHeaders(raw, PLATFORM)))).status).toBe(503);
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('platform secret is accepted for the binding that runs on the platform merchant id', async () => {
    h.attemptFind.mockResolvedValue({ restaurantId: 'r1', gatewayMerchantId: 'M_PLATFORM' });
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw, PLATFORM)))).status).toBe(200);
  });

  it('previous secret accepted only until rotatedAt + 24h', async () => {
    const cfg = (rotatedAgoMs: number) => ({
      webhookSecret: MERCHANT,
      webhookSecretPrevious: 'old_fake_secret',
      webhookSecretRotatedAt: new Date(Date.now() - rotatedAgoMs).toISOString(),
    });
    const raw = flat();
    h.getConfig.mockImplementation(async (rid: string) => (rid === 'r1' ? cfg(23 * 3600_000) : null));
    expect((await POST(req(raw, swHeaders(raw, 'old_fake_secret')))).status).toBe(200);
    h.getConfig.mockImplementation(async (rid: string) => (rid === 'r1' ? cfg(25 * 3600_000) : null));
    expect((await POST(req(raw, swHeaders(raw, 'old_fake_secret', { id: 'evt_2' })))).status).toBe(401);
    expect((await POST(req(raw, swHeaders(raw, MERCHANT, { id: 'evt_3' })))).status).toBe(200);
  });
});

describe('size, identity and freshness', () => {
  it('oversize body: 413 before any secret lookup / HMAC', async () => {
    const big = flat({ metadata: 'x'.repeat(70 * 1024) });
    expect((await POST(req(big, swHeaders(big)))).status).toBe(413);
    // No content-length (chunked stream) is capped while reading too.
    const stream = new ReadableStream({
      start(c) { for (let i = 0; i < 70; i++) c.enqueue(new Uint8Array(1024)); c.close(); },
    });
    expect((await POST(req(stream, swHeaders('x')))).status).toBe(413);
    expect(h.getConfig).not.toHaveBeenCalled();
    expect(h.attemptFind).not.toHaveBeenCalled();
  });

  it('header/body identity mismatch: 400, nothing stored', async () => {
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw, PLATFORM, { xid: 'evt_other' })))).status).toBe(400);
    expect((await POST(req(raw, swHeaders(raw, PLATFORM, { event: 'FAILED' })))).status).toBe(400);
    const up = upstream({ bodyId: 'dlv-other' });
    expect((await POST(req(up.raw, up.headers))).status).toBe(400);
    const noIdentity = JSON.stringify({ event: 'SUCCESS' });
    expect((await POST(req(noIdentity, swHeaders(noIdentity)))).status).toBe(400);
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('stale timestamp + UNKNOWN delivery: 400, never stored', async () => {
    const { raw, headers } = upstream({ tsMs: Date.now() - 20 * 60_000 });
    expect((await POST(req(raw, headers))).status).toBe(400);
    const raw2 = flat();
    expect((await POST(req(raw2, swHeaders(raw2, PLATFORM, { ts: nowSec() + 600 })))).status).toBe(400);
    expect(h.evCreate).not.toHaveBeenCalled();
  });

  it('stale timestamp + KNOWN (durably stored) delivery: 200 deduped, not re-processed', async () => {
    h.evFind.mockResolvedValue({ id: 'ev0' });
    const { raw, headers } = upstream({ tsMs: Date.now() - 20 * 60_000 });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deduped: true });
    expect(h.evFind).toHaveBeenCalledWith({ where: { providerEventId: 'youpi:dlv-1' }, select: { id: true } });
    expect(h.evCreate).not.toHaveBeenCalled();
    expect(h.processNow).not.toHaveBeenCalled();
  });

  it('fresh duplicate (P2002): 200 deduped', async () => {
    h.evCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const raw = flat();
    const res = await POST(req(raw, swHeaders(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deduped: true });
    expect(h.processNow).not.toHaveBeenCalled();
  });
});

describe('durability', () => {
  it('DB down on insert: 503 (gateway retries), no 200 for a non-durable event', async () => {
    h.evCreate.mockRejectedValue(new Error('connection refused'));
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw)))).status).toBe(503);
    expect(h.processNow).not.toHaveBeenCalled();
  });

  it('DB down during binding lookup: 503', async () => {
    h.attemptFind.mockRejectedValue(new Error('connection refused'));
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw)))).status).toBe(503);
  });

  it('inline processing failure does not change the 200 (worker owns correctness)', async () => {
    h.processNow.mockRejectedValue(new Error('gateway down'));
    const raw = flat();
    expect((await POST(req(raw, swHeaders(raw)))).status).toBe(200);
  });
});
