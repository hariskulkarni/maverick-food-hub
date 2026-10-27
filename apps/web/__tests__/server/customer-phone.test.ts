/**
 * Customer phone gate + OTP-verified phone attach/link logic (mocked DB / OTP;
 * the real-Postgres version of the attach + link flow is
 * tests/db/customer-onboarding.db.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { db, otp } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
  otp: { verifyOtp: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/otp', () => otp);
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));

import {
  phoneGateResponse, verifyCustomerPhone, mintLinkTicket, readLinkTicket, maskName, PHONE_REQUIRED_CODE, PHONE_VERIFY_PURPOSE,
} from '@/server/customer-phone';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXTAUTH_SECRET', 'unit-test-secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('phoneGateResponse', () => {
  it('blocks a CUSTOMER without a verified phone with a redirect to the phone step', async () => {
    for (const phoneVerified of [false, undefined]) {
      const res = phoneGateResponse({ user: { role: 'CUSTOMER', phoneVerified } }, '/checkout');
      expect(res?.status).toBe(403);
      const body = await res!.json();
      expect(body.code).toBe(PHONE_REQUIRED_CODE);
      expect(body.redirectTo).toBe('/welcome?next=%2Fcheckout');
    }
  });
  it('lets a verified customer through', () => {
    expect(phoneGateResponse({ user: { role: 'CUSTOMER', phoneVerified: true } }, '/checkout')).toBeNull();
  });
  it('does not affect non-customer roles', () => {
    expect(phoneGateResponse({ user: { role: 'ADMIN', phoneVerified: false } }, '/checkout')).toBeNull();
  });
});

describe('link ticket', () => {
  it('round-trips and rejects tampering and expiry', () => {
    const t = mintLinkTicket({ from: 'g1', to: 'x1', phone: '+919876543210' }, 1_000);
    expect(readLinkTicket(t, 2_000)).toMatchObject({ from: 'g1', to: 'x1', phone: '+919876543210' });
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ from: 'g1', to: 'victim', phone: '+919876543210', exp: 9e12 })).toString('base64url');
    expect(readLinkTicket(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(readLinkTicket(`${body}.x${sig}`, 2_000)).toBeNull();
    expect(readLinkTicket(t, 1_000 + 11 * 60_000)).toBeNull();
    expect(readLinkTicket('garbage', 2_000)).toBeNull();
  });
  it('masks the existing account name', () => {
    expect(maskName('Priya Iyer')).toBe('P***a I.');
    expect(maskName('Al')).toBe('A*');
    expect(maskName(null)).toBeNull();
  });
});

describe('verifyCustomerPhone', () => {
  const me = { id: 'g1', role: 'CUSTOMER', phone: null, phoneVerifiedAt: null, email: 'g@x.com', deletedAt: null, suspendedAt: null };
  const P = '+919876543210';

  it('rejects a malformed number before touching the OTP', async () => {
    expect((await verifyCustomerPhone({ userId: 'g1', phone: '12345', code: '111111' })).status).toBe('invalid_phone');
    expect(otp.verifyOtp).not.toHaveBeenCalled();
  });
  it('refuses non-customers', async () => {
    db.user.findUnique.mockResolvedValueOnce({ ...me, role: 'ADMIN' });
    expect((await verifyCustomerPhone({ userId: 'g1', phone: P, code: '111111' })).status).toBe('forbidden');
  });
  it('a wrong code changes nothing', async () => {
    db.user.findUnique.mockResolvedValueOnce(me);
    otp.verifyOtp.mockResolvedValueOnce(false);
    expect((await verifyCustomerPhone({ userId: 'g1', phone: P, code: '000000' })).status).toBe('invalid_code');
    expect(otp.verifyOtp).toHaveBeenCalledWith({ phone: P, code: '000000', purpose: PHONE_VERIFY_PURPOSE });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('a free number is saved with phoneVerifiedAt', async () => {
    db.user.findUnique.mockResolvedValueOnce(me).mockResolvedValueOnce(null);
    otp.verifyOtp.mockResolvedValueOnce(true);
    expect(await verifyCustomerPhone({ userId: 'g1', phone: P, code: '123456' })).toEqual({ status: 'verified', phone: P });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { phone: P, phoneVerifiedAt: expect.any(Date) } });
  });
  it('a staff / rider number is a conflict and is never merged', async () => {
    db.user.findUnique.mockResolvedValueOnce(me).mockResolvedValueOnce({ id: 'r1', role: 'RIDER', email: null, deletedAt: null, suspendedAt: null });
    otp.verifyOtp.mockResolvedValueOnce(true);
    const r = await verifyCustomerPhone({ userId: 'g1', phone: P, code: '123456' });
    expect(r).toMatchObject({ status: 'conflict', canSignInWithPhone: false });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('an existing customer WITH an email is a conflict (never overwrite), with a sign-in-by-phone path', async () => {
    db.user.findUnique.mockResolvedValueOnce(me).mockResolvedValueOnce({ id: 'x1', role: 'CUSTOMER', email: 'other@x.com', deletedAt: null, suspendedAt: null });
    otp.verifyOtp.mockResolvedValueOnce(true);
    expect(await verifyCustomerPhone({ userId: 'g1', phone: P, code: '123456' })).toMatchObject({ status: 'conflict', canSignInWithPhone: true });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('an existing phone-only customer offers a link ticket (no change yet)', async () => {
    db.user.findUnique.mockResolvedValueOnce(me).mockResolvedValueOnce({ id: 'x1', role: 'CUSTOMER', name: 'Priya Iyer', email: null, deletedAt: null, suspendedAt: null });
    otp.verifyOtp.mockResolvedValueOnce(true);
    const r = await verifyCustomerPhone({ userId: 'g1', phone: P, code: '123456' });
    expect(r.status).toBe('link_available');
    if (r.status !== 'link_available') return;
    expect(r.maskedName).toBe('P***a I.');
    expect(readLinkTicket(r.ticket)).toMatchObject({ from: 'g1', to: 'x1', phone: P });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('an already-verified customer changing to a taken number gets a conflict, not a merge', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ ...me, phone: '+919000000000', phoneVerifiedAt: new Date() })
      .mockResolvedValueOnce({ id: 'x1', role: 'CUSTOMER', email: null, deletedAt: null, suspendedAt: null });
    otp.verifyOtp.mockResolvedValueOnce(true);
    expect(await verifyCustomerPhone({ userId: 'g1', phone: P, code: '123456' })).toMatchObject({ status: 'conflict', canSignInWithPhone: false });
  });
});
