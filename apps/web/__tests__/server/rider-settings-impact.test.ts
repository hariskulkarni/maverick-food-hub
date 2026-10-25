/** computeRiderGateImpact + the client-side validators for /platform/rider-settings. */
import { describe, it, expect, vi } from 'vitest';

const NOW = new Date('2026-10-25T06:00:00Z');
const DAY = 86_400_000;
const ok = (type: string, expiresOn: Date | null = null) => ({ type, status: 'APPROVED', expiresOn });
const allOk = () => ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_RC', 'VEHICLE_INSURANCE'].map((t) => ok(t));
let findManyArgs: any;
let gapsArgs: any;

const riders = [
  // fully approved, online
  { id: 'r1', isOnline: true, user: { id: 'u1', createdAt: NOW }, kycDocuments: allOk() },
  // missing insurance, online
  { id: 'r2', isOnline: true, user: { id: 'u2', createdAt: NOW }, kycDocuments: allOk().filter((d) => d.type !== 'VEHICLE_INSURANCE') },
  // licence expired 2 days ago (inside 3-day grace) → OK; RC pending → blocked; offline
  { id: 'r3', isOnline: false, user: { id: 'u3', createdAt: NOW }, kycDocuments: [ok('AADHAAR'), ok('DRIVING_LICENSE', new Date(NOW.getTime() - 2 * DAY)), { type: 'VEHICLE_RC', status: 'PENDING', expiresOn: null }, ok('VEHICLE_INSURANCE')] },
  // licence expired 5 days ago (past grace) → blocked; offline
  { id: 'r4', isOnline: false, user: { id: 'u4', createdAt: NOW }, kycDocuments: [ok('AADHAAR'), ok('DRIVING_LICENSE', new Date(NOW.getTime() - 5 * DAY)), ok('VEHICLE_RC'), ok('VEHICLE_INSURANCE')] },
];

vi.mock('@/server/db', () => ({
  prisma: { riderProfile: { findMany: async (a: any) => { findManyArgs = a; return riders; } } },
}));
vi.mock('@/server/platform-settings', () => ({ getRiderKycGate: async () => true }));
vi.mock('@/server/training/service', () => ({
  requiredGapsForUsers: async (users: any, audience: any, opts: any) => {
    gapsArgs = { users, audience, opts };
    return new Map([['u1', [{ moduleId: 'm1', title: 'Helmet', overdue: false, needsRecert: false }]]]);
  },
}));

import { computeRiderGateImpact } from '@/server/rider-settings-impact';
import { validateMaxActiveOrders, validateGoal } from '@/lib/rider-settings';

describe('computeRiderGateImpact', () => {
  it('counts riders the KYC and training gates would block, split by online and doc type', async () => {
    const r = await computeRiderGateImpact(NOW);
    expect(r.activeRiders).toBe(4);
    expect(r.onlineRiders).toBe(2);
    expect(r.kyc).toEqual({ blocked: 3, blockedOnline: 1, byType: { VEHICLE_INSURANCE: 1, VEHICLE_RC: 1, DRIVING_LICENSE: 1 } });
    expect(r.training).toEqual({ blocked: 1, blockedOnline: 1 });
    expect(r.computedAt).toBe(NOW.toISOString());
  });

  it('only scans approved, active accounts and asks for shift-blocking rider modules', async () => {
    await computeRiderGateImpact(NOW);
    expect(findManyArgs.where).toEqual({ approvedAt: { not: null }, user: { deletedAt: null, suspendedAt: null } });
    expect(gapsArgs.audience).toBe('RIDER');
    expect(gapsArgs.opts).toMatchObject({ onlyBlocksShift: true });
    expect(gapsArgs.users).toHaveLength(4);
  });
});

describe('validators', () => {
  it('validateMaxActiveOrders', () => {
    expect(validateMaxActiveOrders('2')).toBeNull();
    expect(validateMaxActiveOrders('10')).toBeNull();
    expect(validateMaxActiveOrders('0')).toMatch(/between 1 and 10/);
    expect(validateMaxActiveOrders('11')).toMatch(/between/);
    expect(validateMaxActiveOrders('2.5')).toMatch(/whole number/);
    expect(validateMaxActiveOrders('')).toMatch(/whole number/);
  });
  it('validateGoal', () => {
    expect(validateGoal('1500', 100000)).toBeNull();
    expect(validateGoal('0', 100000)).toMatch(/more than/);
    expect(validateGoal('100001', 100000)).toMatch(/at most/);
    expect(validateGoal('abc', 100000)).toMatch(/rupees/);
  });
});
