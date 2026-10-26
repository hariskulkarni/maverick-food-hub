/**
 * POST /api/integrations/novaryq/webhook/[restaurantId] (CONTRACT §5):
 * X-Novaryq-Signature (t=,v1=) with the restaurant's webhookSecret, constant time,
 * 5-minute window, 64 KiB cap, stored (deduped on the idempotency key) BEFORE 200.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const h = vi.hoisted(() => ({
  cfg: null as any,
  stored: [] as any[],
  storeFails: false,
  inline: [] as string[],
}));

vi.mock('@/server/db', () => {
  const prisma: any = {
    novaryqWebhookEvent: {
      createMany: vi.fn(async ({ data }: any) => {
        if (h.storeFails) throw new Error('db down');
        const d = data[0];
        if (h.stored.some((s) => s.deliveryId === d.deliveryId)) return { count: 0 };
        h.stored.push(d);
        return { count: 1 };
      }),
    },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/novaryq/config', async (orig) => ({ ...(await orig<any>()), loadNovaryqConfig: vi.fn(async () => h.cfg) }));
vi.mock('@/server/novaryq/webhook', async (orig) => ({
  ...(await orig<any>()),
  processNovaryqDeliveryNow: vi.fn(async (key: string) => { h.inline.push(key); }),
}));

import { POST } from '@/app/api/integrations/novaryq/webhook/[restaurantId]/route';
import { verifyNovaryqSignature } from '@/server/novaryq/webhook';

const SECRET = 'whsec_test_123';
const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const BODY = JSON.stringify({
  id: 'evt_1', eventType: 'order.status_changed',
  payload: { orderId: 'nq_1', orderNumber: 7, locationId: 'loc_1', source: 'flavrly', externalRef: 'o1', externalCode: 'ORD-1', status: 'IN_PREP', previousStatus: 'SENT', occurredAt: '2026-10-25T10:00:00Z' },
});

function call(body: string, headers: Record<string, string> = {}, restaurantId = 'r1') {
  const req = new Request(`http://x/api/integrations/novaryq/webhook/${restaurantId}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-novaryq-signature': sign(body),
      'x-novaryq-event': 'order.status_changed',
      'x-novaryq-delivery': 'dlv_1',
      'x-novaryq-idempotency-key': 'dlv_1',
      ...headers,
    },
  });
  return POST(req as any, { params: Promise.resolve({ restaurantId }) });
}

beforeEach(() => {
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.cfg = { baseUrl: 'https://pos.example.com', clientId: 'c', secret: 's', webhookSecret: SECRET, enabled: true, pushOn: 'RECEIVED', webhookSubscriptionId: 'sub_1' };
  h.stored = [];
  h.storeFails = false;
  h.inline = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('verifyNovaryqSignature', () => {
  it('accepts the exact HMAC over `${t}.${rawBody}` and any matching v1 in the header', () => {
    const raw = Buffer.from(BODY);
    expect(verifyNovaryqSignature(raw, sign(BODY), SECRET).ok).toBe(true);
    const t = Math.floor(Date.now() / 1000);
    const multi = `t=${t},v1=${'0'.repeat(64)},${sign(BODY, t).split(',')[1]}`;
    expect(verifyNovaryqSignature(raw, multi, SECRET).ok).toBe(true);
  });
  it('rejects a wrong secret, a tampered body, a missing header and a timestamp outside 5 minutes', () => {
    const raw = Buffer.from(BODY);
    expect(verifyNovaryqSignature(raw, sign(BODY, undefined, 'other'), SECRET)).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(verifyNovaryqSignature(Buffer.from(BODY + ' '), sign(BODY), SECRET)).toMatchObject({ ok: false });
    expect(verifyNovaryqSignature(raw, null, SECRET)).toMatchObject({ ok: false, reason: 'missing' });
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(verifyNovaryqSignature(raw, sign(BODY, old), SECRET)).toMatchObject({ ok: false, reason: 'stale' });
    expect(verifyNovaryqSignature(raw, sign(BODY), '')).toMatchObject({ ok: false });
  });
});

describe('Novaryq webhook route', () => {
  it('valid delivery → stored before 200, keyed per restaurant, then processed inline best-effort', async () => {
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0]).toMatchObject({ restaurantId: 'r1', deliveryId: 'r1:evt:order.status_changed:evt_1', event: 'order.status_changed' });
    expect(h.stored[0].payload).toEqual(JSON.parse(BODY));
    expect(h.inline).toEqual(['r1:evt:order.status_changed:evt_1']);
  });

  it('a redelivery (same idempotency key) is acknowledged and not processed twice', async () => {
    await call(BODY);
    const again = await call(BODY, { 'x-novaryq-attempt': '2' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ deduped: true });
    expect(h.stored).toHaveLength(1);
    expect(h.inline).toHaveLength(1);
  });

  it('a replayed body with a fresh (unsigned) delivery header is still deduped on the signed event id (QA-C5)', async () => {
    await call(BODY);
    const replay = await call(BODY, { 'x-novaryq-delivery': 'forged_2', 'x-novaryq-idempotency-key': 'forged_2' });
    expect(await replay.json()).toMatchObject({ deduped: true });
    expect(h.stored).toHaveLength(1);
  });

  it('bad signature → 401, nothing stored', async () => {
    const res = await call(BODY, { 'x-novaryq-signature': sign(BODY, undefined, 'wrong') });
    expect(res.status).toBe(401);
    expect(h.stored).toHaveLength(0);
  });

  it('a signature for another restaurant\'s secret is refused on this restaurant\'s path', async () => {
    h.cfg = { ...h.cfg, webhookSecret: 'whsec_restaurant_two' };
    expect((await call(BODY)).status).toBe(401);
  });

  it('stale timestamp → 401', async () => {
    const res = await call(BODY, { 'x-novaryq-signature': sign(BODY, Math.floor(Date.now() / 1000) - 600) });
    expect(res.status).toBe(401);
  });

  it('> 64 KiB → 413 before any signature work', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(64 * 1024) });
    const res = await call(big, { 'x-novaryq-signature': sign(big) });
    expect(res.status).toBe(413);
    expect(h.stored).toHaveLength(0);
  });

  it('missing delivery id → 400', async () => {
    const res = await call(BODY, { 'x-novaryq-delivery': '', 'x-novaryq-idempotency-key': '' });
    expect(res.status).toBe(400);
  });

  it('without an envelope id, dedupes on the idempotency key, falling back to X-Novaryq-Delivery', async () => {
    const bare = JSON.stringify({ itemCode: 'SKU-1', available: false });
    await call(bare, { 'x-novaryq-signature': sign(bare), 'x-novaryq-idempotency-key': 'idem_1' });
    await call(bare, { 'x-novaryq-signature': sign(bare), 'x-novaryq-idempotency-key': '', 'x-novaryq-delivery': 'dlv_9' });
    expect(h.stored.map((s) => s.deliveryId)).toEqual(['r1:idem_1', 'r1:dlv_9']);
  });

  it('DB failure → 503 so Novaryq retries', async () => {
    h.storeFails = true;
    expect((await call(BODY)).status).toBe(503);
  });

  it('feature flag off, unconfigured/disabled restaurant or a malformed id → 404', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    expect((await call(BODY)).status).toBe(404);
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
    h.cfg = null;
    expect((await call(BODY)).status).toBe(404);
    h.cfg = { webhookSecret: SECRET, enabled: false };
    expect((await call(BODY)).status).toBe(404);
    expect((await call(BODY, {}, '../etc')).status).toBe(404);
    expect(h.stored).toHaveLength(0);
  });
});
