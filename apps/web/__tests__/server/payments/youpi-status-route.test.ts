import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  attempts: vi.fn(),
  canAccess: vi.fn(),
  reconcile: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/db', () => ({
  prisma: { order: { findUnique: h.findUnique }, pgPaymentAttempt: { findMany: h.attempts } },
}));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: h.rateLimit }));
vi.mock('@/server/tenancy', () => ({ userCanAccessRestaurant: h.canAccess }));
// The route must be read-only: it may never reach the gateway/capture path.
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));

import { GET } from '@/app/api/payments/youpi/status/route';

const call = () => GET(new Request('http://x/api/payments/youpi/status?orderId=o1') as any);

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimit.mockResolvedValue({ ok: true });
  h.findUnique.mockResolvedValue({
    id: 'o1',
    code: 'ORD-1',
    customerId: 'cust1',
    branch: { restaurantId: 'r1' },
    status: 'PAYMENT_PENDING',
    payments: [{ status: 'PENDING' }],
  });
  h.attempts.mockResolvedValue([{ state: 'AWAITING_PAYMENT', expiresAt: null }]);
  h.canAccess.mockResolvedValue(false);
});

describe('GET /api/payments/youpi/status tenant scoping', () => {
  it('non-owner CUSTOMER -> 404 (uniform) and no attempt data read', async () => {
    h.auth.mockResolvedValue({ user: { id: 'other', role: 'CUSTOMER' } });
    expect((await call()).status).toBe(404);
    expect(h.canAccess).not.toHaveBeenCalled();
    expect(h.attempts).not.toHaveBeenCalled();
  });

  it('owning CUSTOMER -> 200', async () => {
    h.auth.mockResolvedValue({ user: { id: 'cust1', role: 'CUSTOMER' } });
    expect((await call()).status).toBe(200);
  });

  it('admin who does NOT manage the order restaurant -> 404 (uniform)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN' } });
    h.canAccess.mockResolvedValue(false);
    expect((await call()).status).toBe(404);
    expect(h.canAccess).toHaveBeenCalledWith('adm1', 'r1');
  });

  it('admin who DOES manage it -> 200', async () => {
    h.auth.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN' } });
    h.canAccess.mockResolvedValue(true);
    expect((await call()).status).toBe(200);
  });

  it('SUPER_ADMIN -> 200 without membership check', async () => {
    h.auth.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    expect((await call()).status).toBe(200);
    expect(h.canAccess).not.toHaveBeenCalled();
  });

  it('anonymous -> 401; missing orderId -> 400; unknown order -> 404', async () => {
    h.auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: 'cust1', role: 'CUSTOMER' } });
    expect((await GET(new Request('http://x/api/payments/youpi/status') as any)).status).toBe(400);
    h.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it('rate limited -> limiter response, no DB read', async () => {
    h.rateLimit.mockResolvedValue({ ok: false, response: new Response('slow down', { status: 429 }) });
    expect((await call()).status).toBe(429);
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments/youpi/status customer-safe view', () => {
  beforeEach(() => h.auth.mockResolvedValue({ user: { id: 'cust1', role: 'CUSTOMER' } }));

  it.each([
    ['AWAITING_PAYMENT', 'PENDING', 'AWAITING_PAYMENT', false],
    ['OBSERVED', 'PENDING', 'CONFIRMING', false],
    ['REVIEW_REQUIRED', 'PENDING', 'VERIFYING', false],
    ['CAPTURED', 'COMPLETED', 'CONFIRMED', false],
    ['FAILED', 'FAILED', 'NOT_CONFIRMED', true],
    ['EXPIRED', 'FAILED', 'NOT_CONFIRMED', true],
  ])('attempt %s -> state %s, phase %s, canRetry %s', async (attemptState, state, phase, canRetry) => {
    h.attempts.mockResolvedValue([{ state: attemptState, expiresAt: null }]);
    const body = await (await call()).json();
    expect(body).toMatchObject({ orderId: 'o1', orderCode: 'ORD-1', state, phase, canRetry });
    expect(typeof body.message).toBe('string');
  });

  it('never calls the gateway / capture path and leaks no evidence fields', async () => {
    h.attempts.mockResolvedValue([{ state: 'OBSERVED', expiresAt: null }]);
    const body = await (await call()).json();
    expect(h.reconcile).not.toHaveBeenCalled();
    for (const k of ['observedUtr', 'utr', 'vpa', 'reviewReason', 'gatewayMerchantId']) expect(body).not.toHaveProperty(k);
    expect(h.attempts).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1' }, select: { state: true, expiresAt: true } }));
  });
});
