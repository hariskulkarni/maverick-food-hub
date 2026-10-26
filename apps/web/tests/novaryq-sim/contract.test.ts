/**
 * Contract tests: the simulator must behave like CONTRACT.md §1–§2 says Novaryq behaves.
 *
 * The "partner surface" block is target-agnostic: with NQ_BASE_URL/NQ_CLIENT_ID/NQ_SECRET/
 * NQ_LOCATION_ID/NQ_ITEM_CODE (+ optional NQ_ITEM_CODE_2) set it runs against a real Novaryq
 * apps/api instead of the simulator, so simulator/real drift shows up as failures here.
 * The "simulator-only" blocks cover fault and webhook injection, which only the simulator has.
 *
 * Run: npx vitest run --config vitest.novaryq-sim.config.ts
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NovaryqSimulator, MAX_ATTEMPTS, fromPaise, toPaise } from './simulator';
import { signRequest, signWebhook, verifyWebhookSignature } from './signing';
import { nqFetch, type NqCreds } from './client';

const REAL = !!process.env.NQ_BASE_URL;
let sim: NovaryqSimulator;
let creds: NqCreds;
let locationId: string;
let codeA: string;
let codeB: string;

/** CONTRACT §2.1 example body, with the item codes of the target. */
const exampleOrder = (externalRef: string, over: Record<string, unknown> = {}) => ({
  locationId,
  serviceMode: 'DELIVERY',
  source: 'flavrly',
  externalRef,
  externalCode: 'FLV-1234',
  customer: { name: 'Asha', phone: '+919800000000' },
  deliveryAddress: 'line1, area, city',
  notes: 'ring the bell',
  lines: [
    { itemCode: codeA, quantity: 2, unitPrice: '249.00', notes: 'less spicy', modifiers: [{ name: 'Extra cheese', unitPrice: '30.00', quantity: 1 }] },
  ],
  totals: { subtotal: '528.00', discount: '50.00', deliveryFee: '30.00', packagingFee: '10.00', tax: '26.40', grandTotal: '544.40' },
  payment: { status: 'PREPAID', method: 'UPI', amount: '544.40' },
  currency: 'INR',
  ...over,
});
const ref = () => `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  if (REAL) {
    creds = { baseUrl: process.env.NQ_BASE_URL!, clientId: process.env.NQ_CLIENT_ID!, secret: process.env.NQ_SECRET! };
    locationId = process.env.NQ_LOCATION_ID!;
    codeA = process.env.NQ_ITEM_CODE!;
    codeB = process.env.NQ_ITEM_CODE_2 ?? codeA;
    return;
  }
  sim = new NovaryqSimulator();
  await sim.start();
  const k = sim.addKey();
  creds = { baseUrl: sim.baseUrl, clientId: k.clientId, secret: k.secret };
  locationId = sim.addLocation('INR').id;
  codeA = NovaryqSimulator.itemCode(
    sim.addItem({ name: 'Paneer Tikka', price: '249.00', sku: 'SKU-123', categoryName: 'Starters', modifierGroups: [{ name: 'Add-ons', options: [{ name: 'Extra cheese', price: '30.00' }] }] }),
  );
  codeB = NovaryqSimulator.itemCode(sim.addItem({ name: 'Dal', price: '180.00', shortCode: 'DAL' }));
});
afterAll(async () => {
  await sim?.stop();
});

describe('partner surface — §1 HMAC request signing', () => {
  it('signs exactly as CONTRACT §1: hex(HMAC_SHA256(key=sha256hex(secret), `${ts}.${rawBody}`))', () => {
    const h = signRequest('nq_live_x', 'nqsec_abc', '{"a":1}', 1_700_000_000);
    const key = createHash('sha256').update('nqsec_abc').digest('hex');
    expect(h['x-signature']).toBe(createHmac('sha256', key).update('1700000000.{"a":1}').digest('hex'));
    expect(h).toMatchObject({ 'x-api-key': 'nq_live_x', 'x-timestamp': '1700000000' });
  });

  it('accepts a correctly signed GET (rawBody is the empty string)', async () => {
    const r = await nqFetch(creds, 'GET', '/api/v1/me');
    expect(r.status).toBe(200);
    expect(r.json.authenticated).toBe(true);
  });

  it('accepts 299 s of clock skew and rejects 301 s (300 s window) in both directions', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await nqFetch(creds, 'GET', '/api/v1/me', undefined, { nowSec: now - 299 })).status).toBe(200);
    expect((await nqFetch(creds, 'GET', '/api/v1/me', undefined, { nowSec: now + 299 })).status).toBe(200);
    const late = await nqFetch(creds, 'GET', '/api/v1/me', undefined, { nowSec: now - 301 });
    expect(late.status).toBe(401);
    expect(late.json).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    expect((await nqFetch(creds, 'GET', '/api/v1/me', undefined, { nowSec: now + 301 })).status).toBe(401);
  });

  it('rejects a tampered body, a wrong secret, an unknown key and missing headers with 401', async () => {
    const body = JSON.stringify(exampleOrder(ref()));
    const h = signRequest(creds.clientId, creds.secret, body);
    const tampered = await fetch(`${creds.baseUrl}/api/v1/orders`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: body.replace('249.00', '1.00') });
    expect(tampered.status).toBe(401);
    expect((await nqFetch({ ...creds, secret: 'nqsec_wrong' }, 'GET', '/api/v1/me')).status).toBe(401);
    expect((await nqFetch({ ...creds, clientId: 'nq_test_unknown' }, 'GET', '/api/v1/me')).status).toBe(401);
    const bare = await fetch(`${creds.baseUrl}/api/v1/me`);
    expect(bare.status).toBe(401);
    const noSig = await fetch(`${creds.baseUrl}/api/v1/me`, { headers: { 'x-api-key': creds.clientId, 'x-timestamp': String(Math.floor(Date.now() / 1000)) } });
    expect(noSig.status).toBe(401);
  });
});

describe('partner surface — §2.1 POST /api/v1/orders', () => {
  it('creates with 201 and returns exactly the §2.1 response fields', async () => {
    const externalRef = ref();
    const r = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    expect(r.status).toBe(201);
    expect(Object.keys(r.json).sort()).toEqual(
      expect.arrayContaining(['id', 'orderNumber', 'locationId', 'status', 'source', 'externalRef', 'externalCode', 'currency', 'grandTotal', 'idempotentReplay'].sort()),
    );
    expect(r.json).toMatchObject({ locationId, source: 'flavrly', externalRef, externalCode: 'FLV-1234', currency: 'INR', idempotentReplay: false });
    // Money is never re-priced: the channel grandTotal comes back verbatim as a decimal string.
    expect(String(r.json.grandTotal)).toMatch(/^544\.40?$/);
    // Lands kitchen-visible without a cashier tap (not OPEN).
    expect(r.json.status).not.toBe('OPEN');
  });

  it('replays the same (source, externalRef) with 200 + idempotentReplay=true and the same id', async () => {
    const externalRef = ref();
    const a = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    const b = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ id: a.json.id, orderNumber: a.json.orderNumber, idempotentReplay: true });
  });

  it('a same-triple replay with a different payload returns the existing order unchanged', async () => {
    const externalRef = ref();
    const a = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    const b = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef, { totals: { grandTotal: '1.00' } }));
    expect(b.status).toBe(200);
    expect(b.json.id).toBe(a.json.id);
    expect(String(b.json.grandTotal)).toBe(String(a.json.grandTotal));
    if (!REAL) expect(sim.warnings.some((w) => w.includes(externalRef))).toBe(true);
  });

  it('20 concurrent creates of one externalRef yield exactly one order', async () => {
    const externalRef = ref();
    const rs = await Promise.all(Array.from({ length: 20 }, () => nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef))));
    expect(new Set(rs.map((r) => r.json.id)).size).toBe(1);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(19);
  });

  it('a different source with the same externalRef is a different order', async () => {
    const externalRef = ref();
    const a = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    const b = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef, { source: 'other-channel' }));
    expect(b.status).toBe(201);
    expect(b.json.id).not.toBe(a.json.id);
  });

  it('unknown item codes -> 422 listing ALL unknown codes, not just the first', async () => {
    const r = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref(), {
      lines: [{ itemCode: 'NOPE-1', quantity: 1 }, { itemCode: codeA, quantity: 1 }, { itemCode: 'NOPE-2', quantity: 1 }],
    }));
    expect(r.status).toBe(422);
    expect(r.json.unknownItemCodes).toEqual(['NOPE-1', 'NOPE-2']);
    expect(r.json).toMatchObject({ statusCode: 422 });
  });

  it('currency different from the location currency -> 422', async () => {
    const r = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref(), { currency: 'USD' }));
    expect(r.status).toBe(422);
  });

  it('rejects an externalRef outside ≤64 [A-Za-z0-9_-]', async () => {
    expect((await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder('bad ref!'))).status).toBe(400);
    expect((await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder('x'.repeat(65)))).status).toBe(400);
    expect((await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder('x'.repeat(64)))).status).toBe(201);
  });
});

describe('partner surface — §2.2 GET /api/v1/orders?externalRef=&source=', () => {
  it('filters to the one order with that externalRef and source, in the list envelope', async () => {
    const externalRef = ref();
    const created = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref()));
    const r = await nqFetch(creds, 'GET', `/api/v1/orders?externalRef=${externalRef}&source=flavrly`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 1, page: 1 });
    expect(r.json.data.map((o: any) => o.id)).toEqual([created.json.id]);
  });
});

describe('partner surface — §2.3 POST /api/v1/orders/:id/cancel', () => {
  it('voids, is idempotent on an already VOIDED order, and validates the reason', async () => {
    const o = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref()));
    expect((await nqFetch(creds, 'POST', `/api/v1/orders/${o.json.id}/cancel`, { reason: 'because' })).status).toBe(400);
    const c1 = await nqFetch(creds, 'POST', `/api/v1/orders/${o.json.id}/cancel`, { reason: 'customer_cancelled', note: 'changed mind' });
    expect(c1.status).toBe(200);
    expect(c1.json.status).toBe('VOIDED');
    const c2 = await nqFetch(creds, 'POST', `/api/v1/orders/${o.json.id}/cancel`, { reason: 'customer_cancelled' });
    expect(c2.status).toBe(200);
    expect(c2.json.status).toBe('VOIDED');
  });

  it('unknown order -> 404', async () => {
    expect((await nqFetch(creds, 'POST', '/api/v1/orders/ord_does_not_exist/cancel', { reason: 'other' })).status).toBe(404);
  });
});

describe('partner surface — §2.5 GET /api/v1/menu', () => {
  it('exposes itemCode, name, price, currency, available, categoryName and modifier groups', async () => {
    const r = await nqFetch(creds, 'GET', `/api/v1/menu?locationId=${locationId}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ page: 1 });
    const item = r.json.data.find((i: any) => i.itemCode === codeA);
    expect(item).toBeTruthy();
    for (const k of ['itemCode', 'name', 'price', 'currency', 'available', 'categoryName', 'modifierGroups']) expect(item).toHaveProperty(k);
    expect(item.currency).toBe('INR');
    expect(Array.isArray(item.modifierGroups)).toBe(true);
  });

  it('missing scope -> 403 (key without read:menu)', async () => {
    if (REAL) return; // a scoped-down key must be minted in the console for the real API
    const k = sim.addKey(['read:orders']);
    const r = await nqFetch({ ...creds, clientId: k.clientId, secret: k.secret }, 'GET', '/api/v1/menu');
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ statusCode: 403, error: 'Forbidden' });
  });
});

// ---------------------------------------------------------------- simulator-only

describe.skipIf(REAL)('simulator — menu, cancel and webhook details', () => {
  it('itemCode precedence is sku → shortCode → id and createOrder resolves all three', async () => {
    const noCodes = sim.addItem({ name: 'Plain', price: '10.00' });
    const menu = (await nqFetch(creds, 'GET', '/api/v1/menu')).json.data;
    expect(menu.find((i: any) => i.name === 'Paneer Tikka').itemCode).toBe('SKU-123');
    expect(menu.find((i: any) => i.name === 'Dal').itemCode).toBe('DAL');
    expect(menu.find((i: any) => i.name === 'Plain').itemCode).toBe(noCodes.menuItemId);
    const r = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref(), { lines: [{ itemCode: noCodes.menuItemId, quantity: 1 }, { itemCode: codeB, quantity: 1 }], totals: undefined, payment: undefined }));
    expect(r.status).toBe(201);
  });

  it('per-location 86 only affects that location', async () => {
    const other = sim.addLocation('INR', 'Second').id;
    sim.set86(codeB, false, other);
    const here = (await nqFetch(creds, 'GET', `/api/v1/menu?locationId=${locationId}`)).json.data.find((i: any) => i.itemCode === codeB);
    const there = (await nqFetch(creds, 'GET', `/api/v1/menu?locationId=${other}`)).json.data.find((i: any) => i.itemCode === codeB);
    expect(here.available).toBe(true);
    expect(there.available).toBe(false);
    sim.set86(codeB, true, other);
  });

  it('cancel: COMPLETED cannot be voided; another API client gets 403', async () => {
    const o = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref()));
    const k2 = sim.addKey();
    const other = { ...creds, clientId: k2.clientId, secret: k2.secret };
    expect((await nqFetch(other, 'POST', `/api/v1/orders/${o.json.id}/cancel`, { reason: 'other' })).status).toBe(403);
    sim.advance(o.json.id, 'COMPLETED');
    expect((await nqFetch(creds, 'POST', `/api/v1/orders/${o.json.id}/cancel`, { reason: 'other' })).status).toBe(409);
  });

  it('records the channel request verbatim (unitPrice, modifiers, totals, payment)', async () => {
    const externalRef = ref();
    await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    const o = sim.orderByExternalRef(externalRef)!;
    expect(o.request.lines[0]).toMatchObject({ unitPrice: '249.00', modifiers: [{ name: 'Extra cheese', unitPrice: '30.00', quantity: 1 }] });
    expect(o.request.payment).toEqual({ status: 'PREPAID', method: 'UPI', amount: '544.40' });
  });

  it('money helpers are exact in paise', () => {
    expect(toPaise('544.40')).toBe(54440);
    expect(toPaise('0.1')).toBe(10);
    expect(fromPaise(54440)).toBe('544.40');
    expect(fromPaise(5)).toBe('0.05');
  });
});

describe.skipIf(REAL)('simulator — signed at-least-once webhook delivery', () => {
  let sink: Server;
  let sinkUrl: string;
  const received: { headers: Record<string, string>; body: string }[] = [];
  let respond = 200;

  beforeAll(async () => {
    sink = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      received.push({ headers: req.headers as Record<string, string>, body: Buffer.concat(chunks).toString() });
      res.writeHead(respond).end();
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => sink.close(() => r())));

  it('NQ-1: there is no API-key webhook API (/api/v1/webhooks -> 404); subscriptions come from the console', async () => {
    expect((await nqFetch(creds, 'GET', '/api/v1/webhooks')).status).toBe(404);
    expect((await nqFetch(creds, 'POST', '/api/v1/webhooks', { url: sinkUrl, events: ['order.status_changed'] })).status).toBe(404);
    const sub = sim.addSubscription(sinkUrl, ['order.status_changed']);
    expect(sub.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    sim.subscriptions.delete(sub.id);
  });

  it("console 'Send test' sends webhook.test with the ad-hoc envelope ({ id, tenantId, eventType, payload, occurredAt }) and max 5 attempts", async () => {
    received.length = 0;
    const sub = sim.addSubscription(sinkUrl, ['order.status_changed']);
    sim.sendTest(sub.id);
    await sim.flush();
    const r = received[0]!;
    expect(r.headers['x-novaryq-event']).toBe('webhook.test');
    expect(r.headers['x-novaryq-max-attempts']).toBe('5');
    expect(verifyWebhookSignature(sub.secret, r.body, r.headers['x-novaryq-signature'])).toBeNull();
    const env = JSON.parse(r.body);
    expect(Object.keys(env).sort()).toEqual(['eventType', 'id', 'occurredAt', 'payload', 'tenantId']);
    expect(env.payload).toEqual({ message: 'Novaryq Open Platform test event', subscriptionId: sub.id });
    sim.subscriptions.delete(sub.id);
  });

  it('delivers order.status_changed with the §2.4 payload and the full signed header set', async () => {
    received.length = 0;
    const sub = sim.addSubscription(sinkUrl, ['order.status_changed']);
    const externalRef = ref();
    const o = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    sim.advance(o.json.id, 'IN_PREP');
    await sim.flush();
    expect(received.length).toBe(2); // OPEN->SENT on create, SENT->IN_PREP
    const last = received[1]!;
    expect(verifyWebhookSignature(sub.secret, last.body, last.headers['x-novaryq-signature'])).toBeNull();
    expect(last.headers['x-novaryq-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(last.headers['x-novaryq-signature']).toContain(`t=${last.headers['x-novaryq-timestamp']},`);
    expect(last.headers['x-novaryq-event']).toBe('order.status_changed');
    expect(last.headers['x-novaryq-idempotency-key']).toBe(last.headers['x-novaryq-delivery']);
    expect(last.headers['x-novaryq-attempt']).toBe('1');
    expect(last.headers['x-novaryq-max-attempts']).toBe('8');
    const env = JSON.parse(last.body);
    expect(env).toMatchObject({ eventType: 'order.status_changed', eventVersion: 1, tenantId: sim.tenantId });
    expect(env.data).toEqual({
      orderId: o.json.id,
      orderNumber: o.json.orderNumber,
      locationId,
      source: 'flavrly',
      externalRef,
      externalCode: 'FLV-1234',
      status: 'IN_PREP',
      previousStatus: 'SENT',
      occurredAt: expect.any(String),
    });
    expect(env.payload).toEqual(env.data);
    sim.subscriptions.delete(sub.id);
  });

  it('availability events carry { itemCode, menuItemId, available, locationId|null, occurredAt }', async () => {
    received.length = 0;
    const sub = sim.addSubscription(sinkUrl, ['menu.item.availability_changed']);
    sim.set86(codeA, false, null);
    sim.set86(codeA, true, locationId);
    await sim.flush();
    const [off, on] = received.map((r) => JSON.parse(r.body).data);
    expect(off).toMatchObject({ itemCode: codeA, available: false, locationId: null });
    expect(on).toMatchObject({ itemCode: codeA, available: true, locationId });
    expect(off.menuItemId).toBeTruthy();
    sim.set86(codeA, true, null);
    sim.subscriptions.delete(sub.id);
    sim.deliveries.length = 0;
  });

  it('retries non-2xx with a stable delivery id, incrementing X-Novaryq-Attempt, dead after 8', async () => {
    received.length = 0;
    respond = 503;
    const sub = sim.addSubscription(sinkUrl, ['menu.item.availability_changed']);
    const [d] = sim.set86(codeB, false, null);
    await sim.flush();
    expect(d!.state).toBe('dead');
    expect(received).toHaveLength(MAX_ATTEMPTS);
    expect(new Set(received.map((r) => r.headers['x-novaryq-delivery']))).toEqual(new Set([d!.id]));
    expect(received.map((r) => r.headers['x-novaryq-attempt'])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    respond = 200;
    sim.set86(codeB, true, null);
    await sim.flush();
    sim.subscriptions.delete(sub.id);
  });

  it('injection: duplicate, out-of-order and exact-byte replay deliveries', async () => {
    received.length = 0;
    const sub = sim.addSubscription(sinkUrl, ['order.status_changed']);
    const o = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref()));
    await sim.flush();
    received.length = 0;
    sim.hold = true;
    sim.advance(o.json.id, 'IN_PREP');
    sim.advance(o.json.id, 'READY');
    expect(received).toHaveLength(0);
    await sim.releaseHeld('reverse');
    expect(received.map((r) => JSON.parse(r.body).data.status)).toEqual(['READY', 'IN_PREP']);
    const d = sim.deliveries.find((x) => x.envelope.data.status === 'READY')!;
    await sim.redeliver(d);
    expect(received[2]!.headers['x-novaryq-delivery']).toBe(d.id);
    expect(received[2]!.headers['x-novaryq-attempt']).toBe('2');
    await sim.replayRaw(d, 0);
    expect(received[3]!.headers['x-novaryq-signature']).toBe(d.attempts[0]!.headers['x-novaryq-signature']);
    expect(received[3]!.body).toBe(d.body);
    sim.subscriptions.delete(sub.id);
  });

  it('signWebhook keys the HMAC with the plaintext subscription secret (not sha256 like requests)', () => {
    const sig = signWebhook('whsec_x', '{}', 1_700_000_000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{}').digest('hex')}`);
  });
});

describe.skipIf(REAL)('simulator — fault injection', () => {
  it('429 + Retry-After (header and body agree)', async () => {
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 429, retryAfterSec: 30 });
    const r = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(ref()));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('30');
    expect(r.json).toMatchObject({ statusCode: 429, error: 'Too Many Requests', retryAfterSec: 30 });
  });

  it('the real 120/min/key budget answers the 121st request with 429 + Retry-After', async () => {
    const s = new NovaryqSimulator();
    await s.start();
    const k = s.addKey();
    const c = { baseUrl: s.baseUrl, clientId: k.clientId, secret: k.secret };
    const rs = [];
    for (let i = 0; i < 121; i++) rs.push((await nqFetch(c, 'GET', '/api/v1/me')).status);
    expect(rs.slice(0, 120).every((x) => x === 200)).toBe(true);
    const last = await nqFetch(c, 'GET', '/api/v1/me');
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    await s.stop();
  });

  it('5xx, slow responses (client timeout) and connection resets', async () => {
    sim.injectFault('GET /api/v1/menu', { kind: 'status', status: 503 });
    expect((await nqFetch(creds, 'GET', '/api/v1/menu')).status).toBe(503);
    sim.injectFault('GET /api/v1/menu', { kind: 'delay', ms: 1_500 });
    await expect(nqFetch(creds, 'GET', '/api/v1/menu', undefined, { timeoutMs: 200 })).rejects.toThrow();
    sim.injectFault('GET /api/v1/menu', { kind: 'reset' });
    await expect(nqFetch(creds, 'GET', '/api/v1/menu')).rejects.toThrow();
    expect((await nqFetch(creds, 'GET', '/api/v1/menu')).status).toBe(200);
  });

  it("an 'after' fault commits the create and loses the response; the retry replays it", async () => {
    const externalRef = ref();
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 504, phase: 'after' });
    expect((await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef))).status).toBe(504);
    expect(sim.orderByExternalRef(externalRef)).toBeTruthy();
    const retry = await nqFetch(creds, 'POST', '/api/v1/orders', exampleOrder(externalRef));
    expect(retry.status).toBe(200);
    expect(retry.json.idempotentReplay).toBe(true);
  });
});
