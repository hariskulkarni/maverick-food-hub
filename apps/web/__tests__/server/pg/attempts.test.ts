import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Exceptions module routed through the fake client's upsert so assertions on the stored row hold.
vi.mock('@/server/pg/exceptions', () => ({
  openException: async (client: any, input: any) => {
    const row = await client.pgReconException.upsert({ where: { dedupeKey: input.dedupeKey }, create: input, update: {} });
    return { id: row?.id ?? input.dedupeKey, created: true };
  },
}));

import type { Store } from './fake-prisma';

const h = vi.hoisted(() => ({
  store: {} as Store,
  resolveBinding: vi.fn(),
  reconcileYoupiPayment: vi.fn(),
  markOrderPaymentFailed: vi.fn(),
}));
vi.mock('@/server/db', async () => {
  const m = await import('./fake-prisma');
  Object.assign(h.store, m.emptyStore());
  return { prisma: m.fakePrisma(h.store) };
});
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/pg/merchant-binding', () => ({ resolveBinding: h.resolveBinding }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcileYoupiPayment }));
vi.mock('@/server/payments/reconcile', () => ({ markOrderPaymentFailed: h.markOrderPaymentFailed }));

import { createPgAttempt, resolveUnknownAttempt, expireStaleAttempts, PgAttemptError, UNKNOWN_GRACE_MS, LIVE_SESSION_MAX_EXTENSION_MS } from '@/server/pg/attempts';

// Obviously fake credentials.
const binding = (over: any = {}) => ({
  restaurantId: 'r1', receivingAccountId: 'acc1', gatewayMerchantId: 'gm1', vpa: 'shop@bank',
  baseUrl: 'https://pg.test', merchantId: 'gm1', webhookSecret: 'whs-fake', credentialSource: 'RESTAURANT', disabledForNew: false,
  limits: { dailyLimit: 20, maxAmountPaise: 500000, maxPendingPerAccount: 5, customerMaxPending: 3, customerWindowMinutes: 15, sessionTtlMinutes: 15 },
  ...over,
});
const order = (id = 'o1', customerId = 'u1') => ({ id, restaurantId: 'r1', customerId, customer: { name: 'A', phone: '9000000000' } });
const opts = { amountPaise: 25050, method: 'RAZORPAY' as const, redirectUrl: 'https://app.test/back' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const view = (attemptKey: string, over: any = {}) => ({
  paymentId: 'gp1', orderId: attemptKey, amountPaise: '25050', currency: 'INR', status: 'INITIATED',
  metadata: { receivingAccountSnapshot: { upiId: 'shop@bank' } }, ...over,
});

/** Gateway double: create -> (fn) ; GET by id / by order -> readback(fn). */
function gateway(o: { create?: (key: string) => Response | Promise<Response>; read?: (key: string) => Response | Promise<Response> }) {
  const calls: { method: string; url: string; body?: any }[] = [];
  let lastKey = '';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (method === 'POST') {
      lastKey = body.orderId;
      return o.create ? o.create(lastKey) : json(201, { paymentId: 'gp1', checkoutUrl: 'https://pay.test/checkout/gp1' });
    }
    const m = /\/orders\/([^/]+)\/cod$/.exec(url);
    const key = m ? decodeURIComponent(m[1]) : lastKey;
    return o.read ? o.read(key) : json(200, view(key));
  });
  return calls;
}

const s = () => h.store;
const attempt = () => s().attempts[0];

beforeEach(() => {
  for (const k of Object.keys(h.store) as (keyof Store)[]) h.store[k] = [];
  h.store.accounts.push({ id: 'acc1' });
  // createPgAttempt locks and checks the order (must be PAYMENT_PENDING / PAYMENT_FAILED).
  for (const [id, customerId] of [['o1', 'u1'], ['o2', 'u2'], ['o3', 'u3'], ['o4', 'u4']]) {
    h.store.orders.push({ id, customerId, status: 'PAYMENT_PENDING', createdAt: new Date() });
  }
  vi.clearAllMocks();
  h.resolveBinding.mockResolvedValue(binding());
  h.markOrderPaymentFailed.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('createPgAttempt', () => {
  it('persists Payment + attempt + reservation BEFORE calling the gateway, then AWAITING_PAYMENT', async () => {
    let seenAtCreate: any;
    gateway({ create: () => ((seenAtCreate = structuredClone(s())), json(201, { paymentId: 'gp1', checkoutUrl: 'https://pay.test/checkout/gp1' })) });
    const r = await createPgAttempt(order(), opts);

    expect(seenAtCreate.attempts).toHaveLength(1);
    expect(seenAtCreate.attempts[0]).toMatchObject({ state: 'CREATED', expectedAmountPaise: 25050, receivingAccountId: 'acc1', gatewayMerchantId: 'gm1' });
    expect(seenAtCreate.payments[0]).toMatchObject({ status: 'PENDING', providerName: 'youpi', amount: '250.50' });
    expect(seenAtCreate.payments[0].providerRef).toBe(seenAtCreate.attempts[0].attemptKey);
    expect(seenAtCreate.reservations[0]).toMatchObject({ state: 'RESERVED', amountPaise: 25050 });

    const a = attempt();
    expect(a.attemptKey).toMatch(/^o1-c[a-z0-9]+$/);
    expect(a.attemptKey).toBe(`o1-${a.id}`);
    expect(a.idempotencyKey).toBe(a.attemptKey);
    expect(a).toMatchObject({ state: 'AWAITING_PAYMENT', gatewayPaymentId: 'gp1' });
    expect(s().payments[0]).toMatchObject({ providerRef: 'gp1', status: 'PENDING' });
    expect(s().payments[0].providerData).toMatchObject({ checkoutUrl: 'https://pay.test/checkout/gp1' });
    expect(s().usage[0].reserved).toBe(1);
    expect(r).toMatchObject({ checkoutUrl: 'https://pay.test/checkout/gp1', gatewayPaymentId: 'gp1', reused: false, amountPaise: 25050 });
    expect(JSON.stringify(r)).not.toContain('whs-fake');
  });

  it('duplicate click: two concurrent starts -> exactly one gateway session', async () => {
    const calls = gateway({});
    const [x, y] = await Promise.allSettled([createPgAttempt(order(), opts), createPgAttempt(order(), opts)]);
    const ok = [x, y].filter((p) => p.status === 'fulfilled');
    const bad = [x, y].filter((p) => p.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad[0].reason).toMatchObject({ status: 409, code: 'ATTEMPT_UNRESOLVED' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(s().attempts).toHaveLength(1);
    expect(s().payments).toHaveLength(1);
  });

  it('a later click returns the same unexpired session without a new gateway call', async () => {
    const calls = gateway({});
    const first = await createPgAttempt(order(), opts);
    const again = await createPgAttempt(order(), opts);
    expect(again).toMatchObject({ reused: true, checkoutUrl: first.checkoutUrl, paymentId: first.paymentId });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    // Different amount for the same order must not reuse it.
    await expect(createPgAttempt(order(), { ...opts, amountPaise: 30000 })).rejects.toMatchObject({ code: 'ATTEMPT_PENDING' });
  });

  it('refuses an already-paid order', async () => {
    s().payments.push({ id: 'old', orderId: 'o1', status: 'CAPTURED' });
    const calls = gateway({});
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ status: 409, code: 'ALREADY_PAID' });
    expect(calls).toHaveLength(0);
  });

  it.each(['CREATE_UNKNOWN', 'OBSERVED', 'REVIEW_REQUIRED', 'CREATED'])('refuses while a %s attempt exists', async (state) => {
    s().attempts.push({ id: 'x', orderId: 'o1', state, createdAt: new Date() });
    const calls = gateway({});
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'ATTEMPT_UNRESOLVED' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a new session when an expired/failed attempt already has a (late) bank allocation (H-06)', async () => {
    s().attempts.push({ id: 'x', orderId: 'o1', state: 'EXPIRED', createdAt: new Date() });
    s().allocations.push({ id: 'al', attemptId: 'x', kind: 'LATE_PAYMENT', reversedAt: null });
    const calls = gateway({});
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ status: 409, code: 'LATE_PAYMENT_RECEIVED' });
    expect(calls).toHaveLength(0);
    // A reversed allocation no longer blocks.
    s().allocations[0].reversedAt = new Date();
    await expect(createPgAttempt(order(), opts)).resolves.toMatchObject({ reused: false });
  });

  it.each(['BANK_VERIFIED', 'CAPTURED'])('refuses as paid when a %s attempt exists', async (state) => {
    s().attempts.push({ id: 'x', orderId: 'o1', state, createdAt: new Date() });
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });

  it('timeout after remote create -> CREATE_UNKNOWN, exception, limit kept, next start refused', async () => {
    gateway({ create: () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')) });
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ status: 503, code: 'CREATE_UNKNOWN' });
    expect(attempt().state).toBe('CREATE_UNKNOWN');
    expect(s().payments[0].status).toBe('PENDING'); // never labelled FAILED on an unknown outcome
    expect(s().exceptions).toEqual([expect.objectContaining({ kind: 'CREATE_UNKNOWN', dedupeKey: `CREATE_UNKNOWN:${attempt().id}`, status: 'OPEN' })]);
    expect(s().reservations[0].state).toBe('RESERVED');
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'ATTEMPT_UNRESOLVED' });
  });

  it.each([500, 503, 408, 409])('HTTP %s on create -> CREATE_UNKNOWN', async (status) => {
    gateway({ create: () => json(status, { error: 'x' }) });
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'CREATE_UNKNOWN' });
    expect(attempt().state).toBe('CREATE_UNKNOWN');
  });

  it('created but readback unavailable -> CREATE_UNKNOWN with gatewayPaymentId, no URL', async () => {
    gateway({ read: () => json(502, {}) });
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'CREATE_UNKNOWN' });
    expect(attempt()).toMatchObject({ state: 'CREATE_UNKNOWN', gatewayPaymentId: 'gp1' });
  });

  it('definitive 4xx -> FAILED, payment FAILED, reservation released', async () => {
    gateway({ create: () => json(401, { code: 'INVALID_MERCHANT_KEY' }) });
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'GATEWAY_REJECTED' });
    expect(attempt().state).toBe('FAILED');
    expect(s().payments[0].status).toBe('FAILED');
    expect(s().reservations[0].state).toBe('RELEASED');
    expect(s().usage[0].reserved).toBe(0);
    // A FAILED attempt does not block a fresh one.
    gateway({});
    await expect(createPgAttempt(order(), opts)).resolves.toMatchObject({ reused: false });
  });

  it.each([
    ['receiver', { metadata: { receivingAccountSnapshot: { upiId: 'attacker@bank' } } }],
    ['receiver missing (public view)', { metadata: undefined }],
    ['amount', { amountPaise: '25000' }],
    ['order', { orderId: 'someone-else' }],
    ['currency', { currency: 'USD' }],
  ])('readback mismatch (%s) -> REVIEW_REQUIRED, RECEIVER_MISMATCH, never a checkout URL', async (_n, over) => {
    gateway({ read: (key) => json(200, view(key, over)) });
    const err = await createPgAttempt(order(), opts).catch((e) => e);
    expect(err).toBeInstanceOf(PgAttemptError);
    expect(err).toMatchObject({ status: 502, code: 'RECEIVER_MISMATCH' });
    expect(JSON.stringify(err)).not.toContain('pay.test');
    expect(attempt()).toMatchObject({ state: 'REVIEW_REQUIRED', gatewayPaymentId: 'gp1' });
    expect(s().exceptions.map((e) => e.kind)).toEqual(['RECEIVER_MISMATCH']);
    expect(s().reservations[0].state).toBe('RESERVED');
    expect(s().payments[0].providerData).not.toHaveProperty('checkoutUrl');
  });

  it('production: checkout origin must match FLAVRLY_PG_CHECKOUT_ORIGIN', async () => {
    const env = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    try {
      delete process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
      await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'CONFIG' });
      expect(s().attempts).toHaveLength(0);
      process.env.FLAVRLY_PG_CHECKOUT_ORIGIN = 'https://pay.flavrly.example';
      gateway({});
      await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ code: 'RECEIVER_MISMATCH' });
      expect(attempt().reviewReason).toContain('checkout_origin');
    } finally {
      (process.env as any).NODE_ENV = env;
      delete process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
    }
  });

  it('disabled merchant / no binding: no new session, no rows, no gateway call', async () => {
    h.resolveBinding.mockResolvedValue(null);
    const calls = gateway({});
    await expect(createPgAttempt(order(), opts)).rejects.toMatchObject({ status: 400, code: 'NO_BINDING' });
    expect(h.resolveBinding).toHaveBeenCalledWith('r1', { forNew: true });
    expect(calls).toHaveLength(0);
    expect(s().payments).toHaveLength(0);
  });

  it('customer velocity: too many live attempts for one customer -> 429, rolled back', async () => {
    h.resolveBinding.mockResolvedValue(binding({ limits: { ...binding().limits, customerMaxPending: 1 } }));
    s().orders.push({ id: 'o0', customerId: 'u1', createdAt: new Date() });
    s().attempts.push({ id: 'x', orderId: 'o0', receivingAccountId: 'acc1', state: 'AWAITING_PAYMENT', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    const calls = gateway({});
    await expect(createPgAttempt(order('o1', 'u1'), opts)).rejects.toMatchObject({ status: 429, code: 'CUSTOMER_VELOCITY' });
    expect(calls).toHaveLength(0);
    expect(s().payments).toHaveLength(0);
    expect(s().attempts).toHaveLength(1);
    // Another customer is unaffected.
    s().orders.push({ id: 'o2', customerId: 'u2', createdAt: new Date() });
    await expect(createPgAttempt(order('o2', 'u2'), opts)).resolves.toMatchObject({ reused: false });
  });

  it('daily cap, amount cap and pending cap are enforced per receiving account', async () => {
    h.resolveBinding.mockResolvedValue(binding({ limits: { ...binding().limits, dailyLimit: 1 } }));
    gateway({});
    await createPgAttempt(order('o1'), opts);
    await expect(createPgAttempt(order('o2', 'u2'), opts)).rejects.toMatchObject({ code: 'DAILY_CAP' });

    h.resolveBinding.mockResolvedValue(binding({ limits: { ...binding().limits, maxAmountPaise: 25049 } }));
    await expect(createPgAttempt(order('o3', 'u3'), opts)).rejects.toMatchObject({ code: 'AMOUNT_CAP' });

    h.resolveBinding.mockResolvedValue(binding({ limits: { ...binding().limits, maxPendingPerAccount: 1 } }));
    await expect(createPgAttempt(order('o4', 'u4'), opts)).rejects.toMatchObject({ code: 'PENDING_CAP' });
    expect(s().attempts).toHaveLength(1);
  });
});

describe('resolveUnknownAttempt', () => {
  async function unknownAttempt() {
    gateway({ create: () => Promise.reject(new Error('socket hang up')) });
    await createPgAttempt(order(), opts).catch(() => undefined);
    vi.restoreAllMocks();
    return attempt();
  }
  const later = () => new Date(Date.now() + UNKNOWN_GRACE_MS + 1000);

  it('does nothing inside the grace window (create may still be in flight)', async () => {
    const a = await unknownAttempt();
    const calls = gateway({});
    expect(await resolveUnknownAttempt(a.id)).toBe('CREATE_UNKNOWN');
    expect(calls).toHaveLength(0);
  });

  it('remote session found and matching -> AWAITING_PAYMENT via lookup by attemptKey', async () => {
    const a = await unknownAttempt();
    const calls = gateway({});
    expect(await resolveUnknownAttempt(a.id, later())).toBe('AWAITING_PAYMENT');
    expect(calls[0].url).toBe(`https://pg.test/api/v1/orders/${a.attemptKey}/cod`);
    expect(h.resolveBinding).toHaveBeenLastCalledWith('r1', { forNew: false, receivingAccountId: 'acc1' });
    expect(attempt()).toMatchObject({ state: 'AWAITING_PAYMENT', gatewayPaymentId: 'gp1' });
    expect(s().payments[0].providerRef).toBe('gp1');
    expect(s().exceptions[0].status).toBe('RESOLVED');
    expect(s().reservations[0].state).toBe('RESERVED');
  });

  it('gateway has no session (404) -> FAILED and reservation released', async () => {
    const a = await unknownAttempt();
    gateway({ read: () => json(404, { error: 'Order not found' }) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('FAILED');
    expect(s().payments[0].status).toBe('FAILED');
    expect(s().reservations[0].state).toBe('RELEASED');
    expect(s().usage[0].reserved).toBe(0);
    expect(s().exceptions[0].status).toBe('RESOLVED');
  });

  it('P1-8: a resolved AWAITING_PAYMENT gets its checkout URL by re-posting the same attemptKey, and is reusable', async () => {
    const a = await unknownAttempt();
    const calls = gateway({});
    expect(await resolveUnknownAttempt(a.id, later())).toBe('AWAITING_PAYMENT');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.orderId)).toEqual([a.attemptKey]);
    expect(s().payments[0].providerData.checkoutUrl).toBe('https://pay.test/checkout/gp1');
    const again = await createPgAttempt(order(), opts);
    expect(again).toMatchObject({ reused: true, attemptId: a.id, checkoutUrl: 'https://pay.test/checkout/gp1' });
  });

  it('P1-8: readback failure keeps the create URL server-side; once the readback proves the receiver it is reused without a new POST', async () => {
    gateway({ read: () => json(502, {}) });
    await createPgAttempt(order(), opts).catch(() => undefined);
    vi.restoreAllMocks();
    expect(s().payments[0].providerData).toMatchObject({ checkoutUrl: 'https://pay.test/checkout/gp1', unverified: true });
    const calls = gateway({ read: () => json(200, view(attempt().attemptKey)) });
    expect(await resolveUnknownAttempt(attempt().id, later())).toBe('AWAITING_PAYMENT');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(s().payments[0].providerData.checkoutUrl).toBe('https://pay.test/checkout/gp1');
    expect(s().payments[0].providerData.unverified).toBeUndefined();
  });

  it('P1-8: the worker re-probes an unknown create after 90 s, long before the 30-min grace, without flagging it stale', async () => {
    const a = await unknownAttempt();
    const t = new Date(Date.now() - 3 * 60_000);
    Object.assign(attempt(), { createdAt: t, updatedAt: t });
    gateway({});
    expect(await expireStaleAttempts()).toMatchObject({ resolved: 1, flagged: 0 });
    expect(s().attempts.find((x) => x.id === a.id)!.state).toBe('AWAITING_PAYMENT');
  });

  it('lookup error -> unchanged', async () => {
    const a = await unknownAttempt();
    gateway({ read: () => json(500, {}) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('CREATE_UNKNOWN');
  });

  it('remote receiver mismatch -> REVIEW_REQUIRED', async () => {
    const a = await unknownAttempt();
    gateway({ read: (k) => json(200, view(k, { metadata: { receivingAccountSnapshot: { upiId: 'x@y' } } })) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('REVIEW_REQUIRED');
    expect(s().exceptions.map((e) => [e.kind, e.status])).toEqual([['CREATE_UNKNOWN', 'RESOLVED'], ['RECEIVER_MISMATCH', 'OPEN']]);
  });

  it('remote EXPIRED with no observation -> EXPIRED and the daily-cap slot is released (round-2 P2, same rule as expiry)', async () => {
    const a = await unknownAttempt();
    gateway({ read: (k) => json(200, view(k, { status: 'EXPIRED' })) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('EXPIRED');
    expect(s().reservations[0].state).toBe('RELEASED');
  });

  it('remote EXPIRED but the gateway was observed paying it -> EXPIRED, limit kept', async () => {
    const a = await unknownAttempt();
    s().evidence.push({ id: 'ev1', attemptId: a.id, status: 'RECORDED' });
    gateway({ read: (k) => json(200, view(k, { status: 'EXPIRED' })) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('EXPIRED');
    expect(s().reservations[0].state).toBe('RESERVED');
  });

  it('remote SUCCESS is not a capture: AWAITING_PAYMENT, payment stays PENDING', async () => {
    const a = await unknownAttempt();
    gateway({ read: (k) => json(200, view(k, { status: 'SUCCESS' })) });
    expect(await resolveUnknownAttempt(a.id, later())).toBe('AWAITING_PAYMENT');
    expect(s().payments[0].status).toBe('PENDING');
  });

  it('disabled merchant still resolves (reconciliation binding)', async () => {
    const a = await unknownAttempt();
    h.resolveBinding.mockImplementation(async (_r: string, o: any) => (o.forNew ? null : binding({ disabledForNew: true })));
    gateway({});
    expect(await resolveUnknownAttempt(a.id, later())).toBe('AWAITING_PAYMENT');
  });

  it('binding now points at a different gateway merchant -> unchanged (cross-tenant guard)', async () => {
    const a = await unknownAttempt();
    h.resolveBinding.mockResolvedValue(binding({ gatewayMerchantId: 'gm-other' }));
    const calls = gateway({});
    expect(await resolveUnknownAttempt(a.id, later())).toBe('CREATE_UNKNOWN');
    expect(calls).toHaveLength(0);
  });
});

describe('expireStaleAttempts', () => {
  async function awaiting() {
    gateway({});
    await createPgAttempt(order(), opts);
    vi.restoreAllMocks();
    return attempt();
  }
  const pastExpiry = () => new Date(attempt().expiresAt.getTime() + 31 * 60_000);

  it('gateway EXPIRED -> attempt EXPIRED, limit released, payment FAILED, order PAYMENT_FAILED', async () => {
    await awaiting();
    gateway({ read: (k) => json(200, view(k, { status: 'EXPIRED' })) });
    const r = await expireStaleAttempts({ now: pastExpiry() });
    expect(r).toMatchObject({ expired: 1, released: 1, ordersFailed: 1 });
    expect(attempt().state).toBe('EXPIRED');
    expect(s().payments[0].status).toBe('FAILED');
    expect(s().reservations[0].state).toBe('RELEASED');
    expect(h.markOrderPaymentFailed).toHaveBeenCalledWith('o1', expect.any(String));
  });

  it('gateway still INITIATED -> not expired inside the bounded extension (P1-9); after it EXPIRED, limit kept', async () => {
    await awaiting();
    gateway({});
    expect(await expireStaleAttempts({ now: pastExpiry() })).toMatchObject({ expired: 0, skipped: 1 });
    expect(attempt().state).toBe('AWAITING_PAYMENT');
    const beyond = new Date(attempt().expiresAt.getTime() + LIVE_SESSION_MAX_EXTENSION_MS + 60_000);
    expect(await expireStaleAttempts({ now: beyond })).toMatchObject({ expired: 1, released: 0 });
    expect(s().reservations[0].state).toBe('RESERVED');
  });

  it('gateway SUCCESS -> never expired; handed to reconcileYoupiPayment', async () => {
    await awaiting();
    gateway({ read: (k) => json(200, view(k, { status: 'SUCCESS' })) });
    expect(await expireStaleAttempts({ now: pastExpiry() })).toMatchObject({ expired: 0 });
    expect(attempt().state).toBe('AWAITING_PAYMENT');
    expect(h.reconcileYoupiPayment).toHaveBeenCalledWith(attempt().paymentId);
    expect(h.markOrderPaymentFailed).not.toHaveBeenCalled();
  });

  it('skips attempts with evidence, inside the grace window, or when the probe fails', async () => {
    const a = await awaiting();
    gateway({ read: () => json(500, {}) });
    expect(await expireStaleAttempts({ now: pastExpiry() })).toMatchObject({ expired: 0, skipped: 1 });
    expect(await expireStaleAttempts({ now: new Date(a.expiresAt.getTime() + 60_000) })).toMatchObject({ expired: 0, skipped: 0 });
    s().evidence.push({ id: 'ev', attemptId: a.id, status: 'RECORDED' });
    gateway({ read: (k) => json(200, view(k, { status: 'EXPIRED' })) });
    expect(await expireStaleAttempts({ now: pastExpiry() })).toMatchObject({ expired: 0, skipped: 0 });
  });

  it('does not fail the order while another attempt is unresolved', async () => {
    await awaiting();
    s().attempts.push({ id: 'other', orderId: 'o1', state: 'REVIEW_REQUIRED', createdAt: new Date(), updatedAt: new Date() });
    gateway({ read: (k) => json(200, view(k, { status: 'FAILED' })) });
    await expireStaleAttempts({ now: new Date(attempt().expiresAt.getTime() + 31 * 60_000) });
    expect(h.markOrderPaymentFailed).not.toHaveBeenCalled();
  });

  it('never expires CREATE_UNKNOWN / OBSERVED / REVIEW_REQUIRED: STALE_PENDING instead', async () => {
    const old = new Date(Date.now() - 2 * 3600_000);
    const veryOld = new Date(Date.now() - 49 * 3600_000);
    const rows: [string, string, Date][] = [['u', 'CREATE_UNKNOWN', old], ['ob', 'OBSERVED', old], ['ob2', 'OBSERVED', veryOld], ['rv', 'REVIEW_REQUIRED', old]];
    for (const [id, state, at] of rows) {
      s().attempts.push({ id, orderId: `o-${id}`, restaurantId: 'r1', receivingAccountId: 'acc1', gatewayMerchantId: 'gm1', attemptKey: `o-${id}-k`, expectedAmountPaise: 100, state, createdAt: at, updatedAt: at });
    }
    gateway({ read: () => json(503, {}) });
    expect(await expireStaleAttempts()).toMatchObject({ flagged: 3, expired: 0 });
    expect(s().attempts.map((a) => a.state)).toEqual(['CREATE_UNKNOWN', 'OBSERVED', 'OBSERVED', 'REVIEW_REQUIRED']);
    // OBSERVED waiting < 48h for the bank statement is normal: not flagged.
    expect(s().exceptions.map((e) => e.attemptId).sort()).toEqual(['ob2', 'rv', 'u']);
    expect(s().exceptions.every((e) => e.kind === 'STALE_PENDING')).toBe(true);
    await expireStaleAttempts();
    expect(s().exceptions).toHaveLength(3); // deduped
  });

  it('a backlog of flagged REVIEW/OBSERVED attempts never starves unknown creates (H-10)', async () => {
    const veryOld = new Date(Date.now() - 30 * 24 * 3600_000);
    for (let i = 0; i < 5; i++) {
      s().attempts.push({ id: `ob${i}`, orderId: `o-ob${i}`, restaurantId: 'r1', receivingAccountId: 'acc1', gatewayMerchantId: 'gm1', attemptKey: `k${i}`, expectedAmountPaise: 100, state: 'OBSERVED', createdAt: veryOld, updatedAt: veryOld });
    }
    const old = new Date(Date.now() - 2 * 3600_000);
    s().payments.push({ id: 'pu', orderId: 'o-u', status: 'PENDING' });
    s().attempts.push({ id: 'u', paymentId: 'pu', orderId: 'o-u', restaurantId: 'r1', receivingAccountId: 'acc1', gatewayMerchantId: 'gm1', attemptKey: 'o-u-k', gatewayPaymentId: null, expectedAmountPaise: 100, state: 'CREATE_UNKNOWN', createdAt: old, updatedAt: old });
    gateway({ read: () => json(404, {}) });
    await expireStaleAttempts({ limit: 5 });
    expect(s().attempts.find((a) => a.id === 'u')!.state).toBe('FAILED');
  });
});
