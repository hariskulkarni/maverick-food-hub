/**
 * Real-PostgreSQL proof of pre-launch test isolation (server/test-accounts.ts,
 * rider-sourcing.testIsolationAllows): a test rider can only see / claim / be
 * assigned test-customer orders, a real rider never gets a test order, the KYC
 * gate is waived only for the test rider (who can only carry test orders), and
 * a test rider cannot request a payout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus } from '@prisma/client';

let session: any = null;
vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/notifications', () => ({ notify: { sms: async () => ({}), email: async () => ({}), whatsapp: async () => ({}) } }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: async () => {}, sendBatchInvitationPush: async () => {} }));
vi.mock('@/server/realtime', () => ({ publish: () => {} }));
vi.mock('@/server/platform-settings', () => ({
  getRiderKycGate: async () => true,
  getRiderMaxActiveOrders: async () => 3,
  getRiderEarningsGoals: async () => ({ daily: 1500, weekly: 9000 }),
}));

import { prisma } from '@/server/db';
import { POST as claim } from '@/app/api/rider/pool/[orderId]/claim/route';
import { GET as pool } from '@/app/api/rider/pool/route';
import { POST as withdraw } from '@/app/api/rider/payouts/route';
import { POST as reassign } from '@/app/api/admin/orders/[id]/reassign/route';
import { assignRider, suggestRiders, RiderAssignError } from '@/server/rider-allocator';
import { createTestAccount } from '@/server/test-accounts';
import { approveAllKyc, makeOrder, makeRestaurant, makeRider } from './rider-fixtures';

const asRider = (userId: string) => (session = { user: { id: userId, role: 'RIDER' } });
const post = (body: unknown = {}) =>
  new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const callClaim = (orderId: string) => claim(post(), { params: Promise.resolve({ orderId }) });

let seq = 0;
async function testRider() {
  const phone = `+9185${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const r = await createTestAccount(phone, undefined, 'RIDER');
  if (!r.ok) throw new Error(r.message);
  const profile = await prisma.riderProfile.update({ where: { userId: r.userId }, data: { isOnline: true } });
  return { userId: r.userId, profile };
}

async function testOrder(branchId: string, status: OrderStatus = OrderStatus.READY) {
  const { order, customer } = await makeOrder(branchId, { status });
  await prisma.user.update({ where: { id: customer.id }, data: { isTestAccount: true } });
  return order;
}

beforeEach(() => {
  session = null;
});

describe('test isolation (real Postgres)', () => {
  it('pool: a test rider sees only test orders, a real rider never sees them', async () => {
    const { branch } = await makeRestaurant();
    const { order: real } = await makeOrder(branch.id);
    const test = await testOrder(branch.id);
    const tr = await testRider();
    const rr = await makeRider();

    asRider(tr.userId);
    const testIds = ((await (await pool(new Request('http://t/api/rider/pool') as any)).json()) as any[]).map((o) => o.orderId);
    expect(testIds).toContain(test.id);
    expect(testIds).not.toContain(real.id);

    asRider(rr.user.id);
    const realIds = ((await (await pool(new Request('http://t/api/rider/pool') as any)).json()) as any[]).map((o) => o.orderId);
    expect(realIds).toContain(real.id);
    expect(realIds).not.toContain(test.id);
  });

  it('claim: cross-side claims are refused; a test rider (no KYC docs) can claim a test order', async () => {
    const { branch } = await makeRestaurant();
    const { order: real } = await makeOrder(branch.id);
    const test = await testOrder(branch.id);
    const tr = await testRider();
    const rr = await makeRider();
    await approveAllKyc(rr.profile.id);

    asRider(tr.userId);
    const r1 = await callClaim(real.id);
    expect(r1.status).toBe(403);
    expect(await prisma.riderAssignment.count({ where: { orderId: real.id } })).toBe(0);

    asRider(rr.user.id);
    const r2 = await callClaim(test.id);
    expect(r2.status).toBe(403);
    expect(await prisma.riderAssignment.count({ where: { orderId: test.id } })).toBe(0);

    asRider(tr.userId);
    const r3 = await callClaim(test.id);
    expect(r3.status).toBe(200);
    const a = await prisma.riderAssignment.findUnique({ where: { orderId: test.id } });
    expect(a?.riderId).toBe(tr.profile.id);
  });

  it('a real rider without KYC is still blocked (the waiver is test-only)', async () => {
    const { branch } = await makeRestaurant();
    const { order: real } = await makeOrder(branch.id);
    const rr = await makeRider();
    asRider(rr.user.id);
    const r = await callClaim(real.id);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('kyc_incomplete');
  });

  it('admin assign and suggestions never pair a test rider with a real order (or vice versa)', async () => {
    const { branch } = await makeRestaurant();
    const { order: real } = await makeOrder(branch.id);
    const test = await testOrder(branch.id);
    const tr = await testRider();
    const rr = await makeRider();
    await approveAllKyc(rr.profile.id);

    await expect(assignRider(real.id, tr.profile.id)).rejects.toBeInstanceOf(RiderAssignError);
    await expect(assignRider(test.id, rr.profile.id)).rejects.toBeInstanceOf(RiderAssignError);
    expect(await prisma.riderAssignment.count({ where: { orderId: { in: [real.id, test.id] } } })).toBe(0);

    const forReal = (await suggestRiders(real.id)).map((s) => s.riderId);
    expect(forReal).not.toContain(tr.profile.id);
    const forTest = (await suggestRiders(test.id)).map((s) => s.riderId);
    expect(forTest).toContain(tr.profile.id);
    expect(forTest).not.toContain(rr.profile.id);

    const a = await assignRider(test.id, tr.profile.id);
    expect(a.riderId).toBe(tr.profile.id);
  });

  it('admin reassign refuses cross-side pairs', async () => {
    const { branch } = await makeRestaurant();
    const { order: real } = await makeOrder(branch.id, { status: OrderStatus.READY });
    const tr = await testRider();
    session = { user: { id: 'sa', role: 'SUPER_ADMIN' } };
    const r = await reassign(post({ riderId: tr.profile.id }), { params: Promise.resolve({ id: real.id }) });
    expect(r.status).toBe(409);
    expect((await r.json()).reason).toBe('test_isolation');
    expect(await prisma.riderAssignment.count({ where: { orderId: real.id } })).toBe(0);
  });

  it('a test rider cannot request a payout', async () => {
    const tr = await testRider();
    asRider(tr.userId);
    const r = await withdraw(post({ amount: 100, method: 'UPI', upiId: 'test@upi' }));
    expect(r.status).toBe(403);
    expect(await prisma.riderPayout.count({ where: { riderId: tr.profile.id } })).toBe(0);
  });
});
