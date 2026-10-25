/** P1-9 / P1-10 / P2-22 — one eligibility check for claim, batch and admin assign. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ rider: null as any, active: 0, kycOk: true, cap: 2 }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async () => m.rider },
    riderAssignment: { count: async () => m.active }
  }
}));
vi.mock('@/server/rider-kyc-gate', () => ({
  riderKycGate: async () => ({ canGoOnline: m.kycOk, message: m.kycOk ? null : 'KYC incomplete: Aadhaar card' })
}));
vi.mock('@/server/platform-settings', () => ({ getRiderMaxActiveOrders: async () => m.cap }));
vi.mock('@/server/group-scope', () => ({ resolveGroupContext: async (id: string) => ({ restaurantIds: [id] }) }));

import { checkRiderEligibility } from '@/server/rider-eligibility';

const order = (mode: string, readyAt = new Date()) => ({
  readyAt,
  branch: { restaurant: { id: 'rest1', riderDispatchMode: mode as any, fleetFallbackMinutes: 10 } }
});
const fleet = (over: any = {}) => ({
  id: 'rp1', approvedAt: new Date(), isOnline: true, riderType: 'FLEET', dedicatedRestaurantId: null,
  user: { deletedAt: null, suspendedAt: null }, ...over
});

beforeEach(() => {
  m.rider = fleet();
  m.active = 0;
  m.kycOk = true;
  m.cap = 2;
});

describe('checkRiderEligibility', () => {
  it('accepts an approved, online, KYC-complete fleet rider on a FLEET_ONLY order', async () => {
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'), { requireOnline: true })).toEqual({ ok: true });
  });
  it('rejects unapproved, suspended/deleted and offline riders', async () => {
    m.rider = fleet({ approvedAt: null });
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'))).toMatchObject({ ok: false, code: 'not_approved' });
    m.rider = fleet({ user: { deletedAt: new Date(), suspendedAt: null } });
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'))).toMatchObject({ ok: false, code: 'account_inactive' });
    m.rider = fleet({ isOnline: false });
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'), { requireOnline: true })).toMatchObject({ ok: false, code: 'offline' });
  });
  it('enforces dispatch policy; admin picks may skip only the DEDICATED_FIRST fleet wait', async () => {
    expect(await checkRiderEligibility('rp1', order('DEDICATED_ONLY'))).toMatchObject({ ok: false, code: 'policy' });
    expect(await checkRiderEligibility('rp1', order('DEDICATED_FIRST'))).toMatchObject({ ok: false, code: 'policy' });
    expect(await checkRiderEligibility('rp1', order('DEDICATED_FIRST'), { ignoreFleetFallbackWindow: true })).toEqual({ ok: true });
    expect(await checkRiderEligibility('rp1', order('DEDICATED_ONLY'), { ignoreFleetFallbackWindow: true })).toMatchObject({ code: 'policy' });
  });
  it('blocks on incomplete KYC and at the concurrent-order cap', async () => {
    m.kycOk = false;
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'))).toMatchObject({ ok: false, code: 'kyc_incomplete' });
    m.kycOk = true;
    m.active = 2;
    expect(await checkRiderEligibility('rp1', order('FLEET_ONLY'))).toMatchObject({ ok: false, code: 'at_capacity', status: 409 });
  });
});
