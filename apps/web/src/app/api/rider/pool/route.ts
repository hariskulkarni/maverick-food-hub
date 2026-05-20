/**
 * GET /api/rider/pool
 * Returns orders that are READY and not yet claimed by any rider,
 * across the entire platform. Optional ?lat=&lng= for distance ranking.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { computeBasePayout } from '@/server/payouts';
import { filterOrdersForRider, resolveDedicatedGroup } from '@/server/rider-sourcing';
import { RiderType } from '@prisma/client';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  // Need riderType + dedicatedRestaurantId so the dispatch engine can decide
  // which orders this rider is actually eligible for.
  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      approvedAt: true,
      riderType: true,
      dedicatedRestaurantId: true
    }
  });
  if (!profile || !profile.approvedAt) return new Response('Rider not approved', { status: 403 });

  // Widen a DEDICATED rider's eligibility to their whole group (parent +
  // children): a rider dedicated to any restaurant in a group sees orders from
  // every restaurant in it. Solo restaurants resolve to just their own id.
  const groupProfile = await resolveDedicatedGroup(profile);

  // Fetch all candidate READY + unassigned orders WITH the restaurant's
  // dispatch policy included, then filter to this rider's eligible subset.
  // (We over-fetch a little and trim in app code so the dispatch rules live
  // in exactly one place — see rider-sourcing.ts.)
  const candidates = await prisma.order.findMany({
    where: { status: 'READY', assignment: null },
    include: { branch: { include: { restaurant: true } }, address: true, items: true, customer: true },
    orderBy: { readyAt: 'asc' },
    take: 60
  });
  const orders = filterOrdersForRider(groupProfile, candidates).slice(0, 30);
  const dedicatedIds = groupProfile.dedicatedGroupRestaurantIds ?? [];

  const out = await Promise.all(orders.map(async (o) => {
    // Tag each item so the native app can badge dedicated vs. fleet work.
    // It's "DEDICATED" when this rider is claiming it as one of their group's
    // own dedicated riders (any restaurant in their group); otherwise fleet.
    const dispatchTag: 'DEDICATED' | 'FLEET' =
      profile.riderType === RiderType.DEDICATED &&
      dedicatedIds.includes(o.branch.restaurant.id)
        ? 'DEDICATED'
        : 'FLEET';
    const payout = await computeBasePayout(o.id);
    return {
      orderId: o.id,
      code: o.code,
      restaurant: o.branch.restaurant.name,
      branch: o.branch.name,
      branchAddress: [o.branch.line1, o.branch.city].filter(Boolean).join(', ') || null,
      branchLoc: o.branch.latitude && o.branch.longitude ? { lat: o.branch.latitude, lng: o.branch.longitude } : null,
      delivery: o.address ? { line: `${o.address.line1}, ${o.address.city}`, lat: o.address.latitude, lng: o.address.longitude } : null,
      itemSummary: o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
      total: Number(o.total),
      payout: payout.payout,
      distanceKm: payout.distanceKm,
      readyAt: o.readyAt,
      dispatchTag
    };
  }));
  return Response.json(out);
}
