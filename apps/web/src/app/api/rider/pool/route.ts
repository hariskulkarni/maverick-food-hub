/**
 * GET /api/rider/pool
 * Returns orders that are READY and not yet claimed by any rider,
 * across the entire platform. Optional ?lat=&lng= for distance ranking.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { computeBasePayout } from '@/server/payouts';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile || !profile.approvedAt) return new Response('Rider not approved', { status: 403 });

  const orders = await prisma.order.findMany({
    where: { status: 'READY', assignment: null },
    include: { branch: { include: { restaurant: true } }, address: true, items: true, customer: true },
    orderBy: { readyAt: 'asc' },
    take: 30
  });

  const out = await Promise.all(orders.map(async (o) => {
    const payout = await computeBasePayout(o.id);
    return {
      orderId: o.id,
      code: o.code,
      restaurant: o.branch.restaurant.name,
      branch: o.branch.name,
      branchLoc: o.branch.latitude && o.branch.longitude ? { lat: o.branch.latitude, lng: o.branch.longitude } : null,
      delivery: o.address ? { line: `${o.address.line1}, ${o.address.city}`, lat: o.address.latitude, lng: o.address.longitude } : null,
      itemSummary: o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
      total: Number(o.total),
      payout: payout.payout,
      distanceKm: payout.distanceKm,
      readyAt: o.readyAt
    };
  }));
  return Response.json(out);
}
