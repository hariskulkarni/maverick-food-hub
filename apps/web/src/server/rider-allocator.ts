/**
 * Rider allocator: scores online riders by distance + current load + ETA.
 * v1: distance + load only (heuristic). v2 hook: pluggable scorer for ML.
 */

import { prisma } from './db';
import { haversineKm } from '@/lib/utils';
import { AssignmentStatus, OrderStatus } from '@prisma/client';
import { publish } from './realtime';

export interface RiderScore {
  riderId: string;
  riderName: string;
  distanceKm: number;
  currentLoad: number;
  rating: number;
  score: number;
}

export type RiderScorer = (input: {
  rider: { id: string; lat: number | null; lng: number | null; load: number; rating: number };
  branch: { lat: number | null; lng: number | null };
  delivery: { lat: number | null; lng: number | null };
}) => number;

export const defaultScorer: RiderScorer = ({ rider, branch, delivery }) => {
  let dist = 0;
  if (rider.lat != null && rider.lng != null && branch.lat != null && branch.lng != null) {
    dist = haversineKm({ lat: rider.lat, lng: rider.lng }, { lat: branch.lat, lng: branch.lng });
  }
  // lower is better; weight load × 2km, rating reduces score (0..0.5km nudge)
  return dist + rider.load * 2 + (5 - rider.rating) * 0.5;
};

export async function suggestRiders(orderId: string, scorer: RiderScorer = defaultScorer): Promise<RiderScore[]> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { branch: true, address: true }
  });
  const riders = await prisma.riderProfile.findMany({
    where: { branchId: order.branchId, isOnline: true, user: { deletedAt: null } },
    include: { user: true }
  });
  const branchLoc = { lat: order.branch.latitude, lng: order.branch.longitude };
  const delivery = order.address ? { lat: order.address.latitude, lng: order.address.longitude } : branchLoc;

  return riders
    .map((r) => {
      const score = scorer({
        rider: { id: r.id, lat: r.currentLat, lng: r.currentLng, load: r.currentLoad, rating: r.rating },
        branch: branchLoc,
        delivery
      });
      const distance = r.currentLat != null && r.currentLng != null && branchLoc.lat != null && branchLoc.lng != null
        ? haversineKm({ lat: r.currentLat, lng: r.currentLng }, { lat: branchLoc.lat as number, lng: branchLoc.lng as number })
        : 0;
      return {
        riderId: r.id,
        riderName: r.user.name ?? r.user.phone ?? r.id,
        distanceKm: Math.round(distance * 10) / 10,
        currentLoad: r.currentLoad,
        rating: r.rating,
        score
      } satisfies RiderScore;
    })
    .sort((a, b) => a.score - b.score);
}

export async function autoAssign(orderId: string): Promise<{ riderId: string } | null> {
  const candidates = await suggestRiders(orderId);
  const best = candidates[0];
  if (!best) return null;
  await assignRider(orderId, best.riderId);
  return { riderId: best.riderId };
}

export async function assignRider(orderId: string, riderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const eligible: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY];
  if (!eligible.includes(order.status)) {
    throw new Error('Order is not eligible for rider assignment');
  }
  const a = await prisma.$transaction(async (tx) => {
    const assn = await tx.riderAssignment.upsert({
      where: { orderId },
      update: { riderId, status: AssignmentStatus.PENDING, assignedAt: new Date(), notes: null },
      create: { orderId, riderId, status: AssignmentStatus.PENDING }
    });
    await tx.riderProfile.update({ where: { id: riderId }, data: { currentLoad: { increment: 1 } } });
    return assn;
  });
  publish(`rider:${riderId}`, { kind: 'assigned', orderId, riderId });
  publish(`order:${orderId}`, { kind: 'assigned', orderId, riderId });
  return a;
}
