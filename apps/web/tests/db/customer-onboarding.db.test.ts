/**
 * Real-PostgreSQL proof of the customer onboarding rules:
 *   - the phone OTP (purpose phone_verify) sets phone + phoneVerifiedAt;
 *     a wrong code changes nothing and counts toward the lockout;
 *   - the resend cooldown still applies to phone_verify;
 *   - a phone owned by a phone-only customer → link ticket → `phone-link`
 *     sign-in moves the Google email onto that account (no duplicate), the
 *     empty Google account is retired, the ticket is single-use, and the next
 *     Google sign-in lands on the linked account;
 *   - never overwrite: owner with another email / staff owner → conflict;
 *   - Google + ALLOW_CUSTOMER_SELF_SIGNUP=false → refused, no row created;
 *   - the session flag (jwt callback) follows the DB.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }));
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));
vi.mock('@/server/notifications', () => ({ notify: { sms: async () => ({ ok: true }), whatsapp: async () => ({ ok: true }), email: async () => ({ ok: true }) } }));
vi.mock('@/server/signup-bonus', () => ({ grantSignupBonus: async () => {} }));

process.env.NEXTAUTH_SECRET ||= 'db-test-secret';

import { prisma } from '@/server/db';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';
import { verifyCustomerPhone, PHONE_VERIFY_PURPOSE } from '@/server/customer-phone';
import { authConfig } from '@/server/auth';
import { startSession } from '@/server/sessions';

const id = () => randomUUID().replace(/-/g, '').slice(0, 10);
/** A fresh valid Indian mobile per test. */
const freshPhone = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const googleUser = () => prisma.user.create({ data: { email: `g-${id()}@example.test`, name: 'Gita Rao', role: 'CUSTOMER' } });
async function codeFor(phone: string) {
  const r = await sendOtp({ phone, purpose: PHONE_VERIFY_PURPOSE });
  expect(r.devCode).toMatch(/^\d{6}$/);
  return r.devCode!;
}
const linkProvider = () => (authConfig.providers as any[]).find((p) => p.id === 'phone-link');
const googleSignIn = (email: string, user: Record<string, unknown> = {}) =>
  (authConfig.callbacks!.signIn as any)({ user: Object.assign(user, { email, name: 'G' }), account: { provider: 'google' } });

afterEach(() => vi.unstubAllEnvs());

describe('OTP verify sets phoneVerifiedAt', () => {
  it('free number: saved and verified', async () => {
    const g = await googleUser();
    const phone = freshPhone();
    const r = await verifyCustomerPhone({ userId: g.id, phone, code: await codeFor(phone) });
    expect(r).toEqual({ status: 'verified', phone });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.phone).toBe(phone);
    expect(row.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it('wrong code: nothing saved, failure counted toward the lockout', async () => {
    const g = await googleUser();
    const phone = freshPhone();
    const good = await codeFor(phone);
    const wrong = good === '000000' ? '111111' : '000000';
    expect((await verifyCustomerPhone({ userId: g.id, phone, code: wrong })).status).toBe('invalid_code');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: g.id } })).phoneVerifiedAt).toBeNull();
    const tracker = await prisma.otpAttempt.findUniqueOrThrow({ where: { id: `${phone}:PHONE_VERIFY` } });
    expect(tracker.attempts).toBe(1);
  });

  it('rate limits intact: the 45s resend cooldown applies to phone_verify', async () => {
    const phone = freshPhone();
    await codeFor(phone);
    await expect(sendOtp({ phone, purpose: PHONE_VERIFY_PURPOSE })).rejects.toBeInstanceOf(OtpRateLimitedError);
  });
});

describe('phone already on another account', () => {
  it('phone-only customer: link ticket → one account, Google email moved, ticket single-use', async () => {
    const phone = freshPhone();
    const existing = await prisma.user.create({ data: { phone, role: 'CUSTOMER', name: 'Priya Iyer', phoneVerifiedAt: new Date() } });
    const g = await googleUser();
    const r = await verifyCustomerPhone({ userId: g.id, phone, code: await codeFor(phone) });
    expect(r.status).toBe('link_available');
    if (r.status !== 'link_available') return;
    expect(r.maskedName).toBe('P***a I.');
    // Nothing changes until the customer confirms.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).email).toBeNull();

    const signedIn = await linkProvider().authorize({ ticket: r.ticket });
    expect(signedIn).toMatchObject({ id: existing.id, email: g.email });
    const merged = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(merged.email).toBe(g.email);
    expect(merged.name).toBe('Priya Iyer'); // existing data is not overwritten
    const retired = await prisma.user.findUniqueOrThrow({ where: { id: g.id } });
    expect(retired.email).toBeNull();
    expect(retired.deletedAt).toBeInstanceOf(Date);

    expect(await linkProvider().authorize({ ticket: r.ticket })).toBeNull(); // single use
    const u: Record<string, unknown> = {};
    expect(await googleSignIn(g.email!, u)).toBe(true);
    expect(u.id).toBe(existing.id); // next Google sign-in lands on the linked account
  });

  it('customer with a different email: conflict, nothing overwritten', async () => {
    const phone = freshPhone();
    const other = await prisma.user.create({ data: { phone, role: 'CUSTOMER', email: `o-${id()}@example.test`, phoneVerifiedAt: new Date() } });
    const g = await googleUser();
    const r = await verifyCustomerPhone({ userId: g.id, phone, code: await codeFor(phone) });
    expect(r).toMatchObject({ status: 'conflict', canSignInWithPhone: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).email).toBe(other.email);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: g.id } })).phone).toBeNull();
  });

  it('rider-owned number: conflict, never merged', async () => {
    const phone = freshPhone();
    await prisma.user.create({ data: { phone, role: 'RIDER', name: 'R' } });
    const g = await googleUser();
    expect(await verifyCustomerPhone({ userId: g.id, phone, code: await codeFor(phone) })).toMatchObject({ status: 'conflict', canSignInWithPhone: false });
  });
});

describe('Google self-signup gate + session flag', () => {
  it('ALLOW_CUSTOMER_SELF_SIGNUP=false: unknown Google email refused, no row created', async () => {
    vi.stubEnv('ALLOW_CUSTOMER_SELF_SIGNUP', 'false');
    const email = `nobody-${id()}@example.test`;
    expect(await googleSignIn(email)).toBe('/login/invite-only');
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('jwt flag follows the DB: unverified → verified after the OTP step', async () => {
    const g = await googleUser();
    const sid = await startSession(g.id, {});
    const jwt = authConfig.callbacks!.jwt as any;
    expect((await jwt({ token: { uid: g.id, sid } })).phoneVerified).toBe(false);
    const phone = freshPhone();
    await verifyCustomerPhone({ userId: g.id, phone, code: await codeFor(phone) });
    expect((await jwt({ token: { uid: g.id, sid } })).phoneVerified).toBe(true);
  });
});
