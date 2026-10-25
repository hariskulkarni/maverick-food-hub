/**
 * Real-PostgreSQL proof for the rider audit P0/P1 money paths:
 *   P0-1 repeat / concurrent deliver pays once; deliver on a cancelled order pays nothing
 *   P0-2 deliver frees the load slot and counts the delivery (single source of truth)
 *   P0-4 claim creates the COD record; deliver marks the cash collected
 *   P1-6 concurrent withdrawals can't overdraw; COD cash is netted; FAILED can't overwrite PAID
 *   P1-13 two riders logging the same referee phone → exactly one referral
 * Route handlers run for real against the DB; only auth + outbound
 * notifications/realtime are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignmentStatus, OrderStatus } from '@prisma/client';

let session: any = null;
vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/tenancy', () => ({
  requireSuperAdmin: async () => {
    if (session?.user.role !== 'SUPER_ADMIN') throw new Response('Forbidden', { status: 403 });
    return session;
  }
}));
vi.mock('@/server/notifications', () => ({ notify: { sms: async () => ({}), email: async () => ({}), whatsapp: async () => ({}) } }));
vi.mock('@/server/notify-templates', () => ({ sendDeliveryOtpSms: async () => {} }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: async () => {} }));
vi.mock('@/server/reviews/feedback-request', () => ({ requestFeedbackOnDelivered: async () => {} }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: async () => {}, sendBatchInvitationPush: async () => {} }));
vi.mock('@/server/realtime', () => ({ publish: () => {} }));
vi.mock('@/server/platform-settings', () => ({
  getRiderKycGate: async () => true,
  getRiderMaxActiveOrders: async () => 2,
  getRiderEarningsGoals: async () => ({ daily: 1500, weekly: 9000 })
}));

import { prisma } from '@/server/db';
import { POST as deliver } from '@/app/api/rider/assignments/[id]/deliver/route';
import { POST as claim } from '@/app/api/rider/pool/[orderId]/claim/route';
import { POST as withdraw } from '@/app/api/rider/payouts/route';
import { PATCH as settle } from '@/app/api/platform/rider-payouts/[id]/route';
import { POST as refer } from '@/app/api/rider/referrals/route';
import { transitionOrder } from '@/server/orders';
import { approveAllKyc, makeAssignment, makeOrder, makeRestaurant, makeRider } from './fixtures';

const asRider = (userId: string) => (session = { user: { id: userId, role: 'RIDER' } });
const req = (body: unknown) =>
  new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const callDeliver = (id: string, otp = '4821') => deliver(req({ otp }), { params: Promise.resolve({ id }) });

async function pickedUpDelivery(earnings = 60) {
  const { branch } = await makeRestaurant();
  const { user, profile } = await makeRider();
  const { order } = await makeOrder(branch.id, { status: OrderStatus.OUT_FOR_DELIVERY, total: 500 });
  await prisma.codCollection.create({ data: { orderId: order.id, riderId: profile.id, amountToCollect: 500 } });
  const a = await makeAssignment({
    orderId: order.id, riderId: profile.id, status: AssignmentStatus.PICKED_UP, earningsAmt: earnings, baseEarningsAmt: earnings
  });
  return { user, profile, order, a };
}

beforeEach(() => {
  session = null;
});

describe('P0-1 / P0-2 / P0-4: deliver', () => {
  it('pays once on a repeated POST, frees the load slot, counts the delivery and collects COD', async () => {
    const { user, profile, order, a } = await pickedUpDelivery(60);
    asRider(user.id);
    const r1 = await callDeliver(a.id);
    expect(r1.status).toBe(200);
    const r2 = await callDeliver(a.id); // lost response → app retries
    expect(r2.status).toBe(200);
    expect((await r2.json()).alreadyDelivered).toBe(true);

    const p = await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(Number(p.totalEarnings)).toBe(60);
    expect(p.totalDeliveries).toBe(1);
    expect(p.currentLoad).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.DELIVERED);
    const cod = await prisma.codCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(cod.status).toBe('COLLECTED');
    expect(Number(cod.amountCollected)).toBe(500);
  });

  it('pays once when two deliver requests race', async () => {
    const { user, profile, a } = await pickedUpDelivery(75);
    asRider(user.id);
    const rs = await Promise.all([callDeliver(a.id), callDeliver(a.id), callDeliver(a.id)]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const p = await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(Number(p.totalEarnings)).toBe(75);
    expect(p.totalDeliveries).toBe(1);
    expect(p.currentLoad).toBe(0);
  });

  it('never pays for a cancelled order', async () => {
    const { user, profile, order, a } = await pickedUpDelivery(60);
    await transitionOrder(order.id, OrderStatus.CANCELLED_BY_ADMIN);
    asRider(user.id);
    const r = await callDeliver(a.id);
    expect(r.status).toBe(409);
    const p = await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(Number(p.totalEarnings)).toBe(0);
    expect(p.currentLoad).toBe(0); // released by the cancellation
    expect((await prisma.codCollection.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe('WAIVED');
  });

  it('locks after 5 wrong codes even if the right one follows', async () => {
    const { user, profile, a } = await pickedUpDelivery(60);
    asRider(user.id);
    for (let i = 0; i < 4; i++) expect((await callDeliver(a.id, '0000')).status).toBe(400);
    expect((await callDeliver(a.id, '0000')).status).toBe(429);
    expect((await callDeliver(a.id, '4821')).status).toBe(429);
    expect(Number((await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } })).totalEarnings)).toBe(0);
  });
});

describe('P0-4: claim creates the COD record', () => {
  it('pool claim on a COD order creates PENDING_COLLECTION for the claimer', async () => {
    const { branch } = await makeRestaurant();
    const { user, profile } = await makeRider();
    await approveAllKyc(profile.id);
    const { order } = await makeOrder(branch.id, { total: 320 });
    asRider(user.id);
    const r = await claim({} as any, { params: Promise.resolve({ orderId: order.id }) });
    expect(r.status).toBe(200);
    const cod = await prisma.codCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(cod.riderId).toBe(profile.id);
    expect(Number(cod.amountToCollect)).toBe(320);
    expect(cod.status).toBe('PENDING_COLLECTION');
  });

  it('refuses a claim when KYC is incomplete', async () => {
    const { branch } = await makeRestaurant();
    const { user } = await makeRider();
    const { order } = await makeOrder(branch.id);
    asRider(user.id);
    const r = await claim({} as any, { params: Promise.resolve({ orderId: order.id }) });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('kyc_incomplete');
  });
});

describe('P1-6: withdrawals', () => {
  it('concurrent withdrawals cannot exceed the balance', async () => {
    const { user, profile } = await makeRider();
    await prisma.riderProfile.update({ where: { id: profile.id }, data: { totalEarnings: 1000 } });
    asRider(user.id);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => withdraw(req({ amount: 400, method: 'UPI', upiId: 'r@upi' })))
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(2);
    const sum = await prisma.riderPayout.aggregate({ where: { riderId: profile.id }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(800);
  });

  it('nets COD cash the rider still holds', async () => {
    const { branch } = await makeRestaurant();
    const { user, profile } = await makeRider();
    await prisma.riderProfile.update({ where: { id: profile.id }, data: { totalEarnings: 1000 } });
    const { order } = await makeOrder(branch.id, { status: OrderStatus.DELIVERED });
    await prisma.codCollection.create({
      data: { orderId: order.id, riderId: profile.id, amountToCollect: 700, amountCollected: 700, status: 'COLLECTED' }
    });
    asRider(user.id);
    expect((await withdraw(req({ amount: 400, method: 'UPI', upiId: 'r@upi' }))).status).toBe(400);
    expect((await withdraw(req({ amount: 300, method: 'UPI', upiId: 'r@upi' }))).status).toBe(200);
  });

  it('a FAILED settle cannot overwrite PAID', async () => {
    const { profile } = await makeRider();
    const po = await prisma.riderPayout.create({ data: { riderId: profile.id, amount: 100, status: 'REQUESTED' } });
    session = { user: { id: 'sa', role: 'SUPER_ADMIN' } };
    const patch = (status: string) =>
      settle(new Request('http://t/x', { method: 'PATCH', body: JSON.stringify({ status }) }) as any, { params: Promise.resolve({ id: po.id }) });
    const [a, b] = await Promise.all([patch('PAID'), patch('FAILED')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const final = await prisma.riderPayout.findUniqueOrThrow({ where: { id: po.id } });
    expect((await patch(final.status === 'PAID' ? 'FAILED' : 'PAID')).status).toBe(409);
    expect((await prisma.riderPayout.findUniqueOrThrow({ where: { id: po.id } })).status).toBe(final.status);
  });
});

describe('P1-13: referrals', () => {
  it('one referral per referee phone across riders, unique codes per row', async () => {
    const r1 = await makeRider();
    const r2 = await makeRider();
    const phone = '9' + String(Date.now()).slice(-9);
    asRider(r1.user.id);
    const first = await refer(req({ refereePhone: '+91' + phone }));
    expect(first.status).toBe(201);
    // Second referral by the same rider (different phone) must not 500 on the unique code.
    const second = await refer(req({ refereePhone: '8' + String(Date.now() + 7).slice(-9) }));
    expect(second.status).toBe(201);
    // Another rider racing on the same phone → 409.
    asRider(r2.user.id);
    const dupe = await refer(req({ refereePhone: phone }));
    expect(dupe.status).toBe(409);
  });
});
