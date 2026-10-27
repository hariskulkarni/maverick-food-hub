/**
 * Customer phone gate on the order + reservation APIs, and the phone OTP /
 * verify / onboarding routes (auth, validation, rate-limit mapping).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  placeOrder: vi.fn(),
  sendOtp: vi.fn(),
  verifyCustomerPhone: vi.fn(),
  userUpdate: vi.fn(),
  resolveBranch: vi.fn(),
  createReservation: vi.fn(),
}));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => h.session) }));
vi.mock('@/server/orders', () => ({ placeOrder: h.placeOrder, PgUnavailableError: class extends Error {}, CheckoutRejectedError: class extends Error {} }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/otp', () => {
  class OtpRateLimitedError extends Error { constructor(public retryAfterSeconds: number, m: string) { super(m); } }
  class OtpDeliveryError extends Error {}
  return { sendOtp: h.sendOtp, OtpRateLimitedError, OtpDeliveryError, verifyOtp: vi.fn() };
});
vi.mock('@/server/db', () => ({ prisma: { user: { update: h.userUpdate } } }));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/app/api/r/[slug]/reservations/_helpers', () => ({ resolveBranchForSlug: h.resolveBranch, serializeReservation: (r: unknown) => r }));
vi.mock('@/server/reservations', () => ({ createReservation: h.createReservation, confirmReservation: vi.fn(), attachDepositOrder: vi.fn() }));
vi.mock('@/server/payments', () => ({ paymentProvider: vi.fn() }));
vi.mock('@/server/customer-phone', async (orig) => ({
  ...(await orig<typeof import('@/server/customer-phone')>()),
  verifyCustomerPhone: h.verifyCustomerPhone,
}));

import { POST as placeOrderRoute } from '@/app/api/orders/route';
import { POST as reserveRoute } from '@/app/api/r/[slug]/reservations/route';
import { POST as otpRoute } from '@/app/api/customer/phone/otp/route';
import { POST as verifyRoute } from '@/app/api/customer/phone/verify/route';
import { POST as onboardingRoute } from '@/app/api/customer/onboarding/route';
import { OtpRateLimitedError } from '@/server/otp';

const customer = (phoneVerified: boolean) => ({ user: { id: 'c1', role: 'CUSTOMER', phone: phoneVerified ? '+919876543210' : null, phoneVerified } });
const jsonReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as any;
const orderBody = { branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 1 }], paymentMethod: 'COD' };

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
});

describe('order gate: no verified phone → cannot order; verified → can', () => {
  it('refuses an unverified customer with 403 + phone-step redirect, and never reaches placeOrder', async () => {
    h.session = customer(false);
    const res = await placeOrderRoute({ json: async () => orderBody } as any);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'PHONE_VERIFICATION_REQUIRED', redirectTo: '/welcome?next=%2Fcheckout' });
    expect(h.placeOrder).not.toHaveBeenCalled();
  });
  it('places the order for a verified customer', async () => {
    h.session = customer(true);
    h.placeOrder.mockResolvedValueOnce({ order: { id: 'o1', code: 'A1', fulfillmentType: 'DELIVERY', pickupCode: null, scheduledFor: null }, payment: null });
    const res = await placeOrderRoute({ json: async () => orderBody } as any);
    expect(res.status).toBe(200);
    expect(h.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1' }));
  });
});

describe('reservation gate', () => {
  beforeEach(() => h.resolveBranch.mockResolvedValue({ branchId: 'b1', dineInEnabled: true }));
  it('refuses an unverified customer before any booking work', async () => {
    h.session = customer(false);
    const res = await reserveRoute(jsonReq({ tableId: 't1', partySize: 2 }), { params: Promise.resolve({ slug: 'spice' }) });
    expect(res.status).toBe(403);
    expect((await res.json()).redirectTo).toBe('/welcome?next=%2Fr%2Fspice');
    expect(h.createReservation).not.toHaveBeenCalled();
  });
});

describe('POST /api/customer/phone/otp', () => {
  it('requires a signed-in customer', async () => {
    expect((await otpRoute(jsonReq({ phone: '+919876543210' }))).status).toBe(401);
    h.session = { user: { id: 'a1', role: 'ADMIN' } };
    expect((await otpRoute(jsonReq({ phone: '+919876543210' }))).status).toBe(403);
  });
  it('validates the Indian mobile number', async () => {
    h.session = customer(false);
    for (const phone of ['12345', '+915876543210', '+1 415 555 0100']) {
      expect((await otpRoute(jsonReq({ phone }))).status).toBe(400);
    }
    expect(h.sendOtp).not.toHaveBeenCalled();
  });
  it('sends with the phone_verify purpose and the trusted client IP', async () => {
    h.session = customer(false);
    h.sendOtp.mockResolvedValueOnce({ ok: true, devCode: '123456', testAccount: true });
    const res = await otpRoute(jsonReq({ phone: '+919876543210' }, { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' }));
    expect(await res.json()).toEqual({ ok: true, devCode: '123456', testAccount: true });
    expect(h.sendOtp).toHaveBeenCalledWith({ phone: '+919876543210', purpose: 'phone_verify', ipAddress: '9.9.9.9' });
  });
  it('keeps the OTP engine limits: cooldown / caps surface as 429 + Retry-After', async () => {
    h.session = customer(false);
    h.sendOtp.mockRejectedValueOnce(new (OtpRateLimitedError as any)(42, 'Please wait 42s before requesting another code.'));
    const res = await otpRoute(jsonReq({ phone: '+919876543210' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(await res.json()).toMatchObject({ retryAfter: 42 });
  });
  it('refuses re-verifying the number already verified on the account', async () => {
    h.session = customer(true);
    expect((await otpRoute(jsonReq({ phone: '+919876543210' }))).status).toBe(400);
  });
});

describe('POST /api/customer/phone/verify', () => {
  it('maps results to statuses', async () => {
    h.session = customer(false);
    h.verifyCustomerPhone.mockResolvedValueOnce({ status: 'verified', phone: '+919876543210' });
    expect((await verifyRoute(jsonReq({ phone: '+919876543210', code: '123456' }))).status).toBe(200);
    h.verifyCustomerPhone.mockResolvedValueOnce({ status: 'conflict', message: 'taken', canSignInWithPhone: true });
    const c = await verifyRoute(jsonReq({ phone: '+919876543210', code: '123456' }));
    expect(c.status).toBe(409);
    expect(await c.json()).toMatchObject({ error: 'taken', canSignInWithPhone: true });
    h.verifyCustomerPhone.mockResolvedValueOnce({ status: 'invalid_code', message: 'wrong' });
    expect((await verifyRoute(jsonReq({ phone: '+919876543210', code: '000000' }))).status).toBe(400);
    expect(h.verifyCustomerPhone).toHaveBeenLastCalledWith({ userId: 'c1', phone: '+919876543210', code: '000000' });
  });
});

describe('POST /api/customer/onboarding', () => {
  it('saves name + known cuisines, rejects unknown cuisines and bad names', async () => {
    h.session = customer(true);
    h.userUpdate.mockResolvedValueOnce({ name: 'Priya', favoriteCuisines: ['Biryani'], onboardedAt: null });
    expect((await onboardingRoute(jsonReq({ name: ' Priya ', favoriteCuisines: ['Biryani', 'Biryani'] }))).status).toBe(200);
    expect(h.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Priya', favoriteCuisines: ['Biryani'] } }));
    expect((await onboardingRoute(jsonReq({ favoriteCuisines: ['Martian'] }))).status).toBe(400);
    expect((await onboardingRoute(jsonReq({ name: '<script>' }))).status).toBe(400);
  });
  it('completing requires a verified phone', async () => {
    h.session = customer(false);
    expect((await onboardingRoute(jsonReq({ complete: true }))).status).toBe(403);
    h.session = customer(true);
    h.userUpdate.mockResolvedValueOnce({});
    expect((await onboardingRoute(jsonReq({ complete: true }))).status).toBe(200);
    expect(h.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { onboardedAt: expect.any(Date) } }));
  });
});
