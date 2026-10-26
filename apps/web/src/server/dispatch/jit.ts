/**
 * JIT rider invitations (behind the platform setting, default OFF).
 *
 * Today a DELIVERY order is offered to riders (pool publish + push + batch)
 * only when the kitchen marks it READY, so food waits for a rider. With JIT on,
 * every accepted DELIVERY order gets an OrderDispatchPlan whose release time is
 *
 *   releaseAt = acceptedAt + predicted_prep − rider_travel − buffer
 *   rider_travel = nearest idle eligible rider (haversine × roadFactor) / speed
 *
 * and the 1-minute sweep releases it into the EXISTING dispatch flow (pool
 * publish + rider push) once due — or immediately when no eligible rider is
 * within range, or when the delivery promise has no slack left. Food READY
 * always releases (as before), so JIT can only bring an invitation forward,
 * never push it later. With the setting off nothing is held and the old flow
 * is untouched.
 */
import { riderTestSideFilter } from '../rider-sourcing';
import { FulfillmentType, OrderEventSource, OrderEventType, OrderStatus, RiderDispatchMode, RiderType, AssignmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { publish } from '../realtime';
import { haversineKm } from '@/lib/utils';
import { getJitConfig, type DispatchJitConfig } from './settings';
import { predictPrepMinutes } from './prep';
import { recordOrderEvent, safeWarn } from './events';

const MIN = 60_000;
/** Held plans older than this are ignored by the sweep (order long gone/abandoned). */
const PLAN_HORIZON_MS = 6 * 60 * MIN;
/** Rider fixes older than this don't count for "nearest rider". */
const RIDER_FIX_MAX_AGE_MS = 15 * MIN;
export const PRE_READY_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING];

export type ReleaseReason = 'jit_due' | 'no_rider_in_range' | 'promise_at_risk' | 'food_ready';

export interface JitDecisionInput {
  now: Date;
  acceptedAt: Date;
  predictedPrepMin: number;
  /** Distance (km, straight line) from the nearest idle eligible rider to the restaurant; null = none known. */
  nearestRiderKm: number | null;
  /** Straight-line restaurant → customer distance (km); null = unknown (treated as 0). */
  deliveryKm: number | null;
  promisedAt: Date;
  cfg: Pick<DispatchJitConfig, 'bufferMin' | 'roadFactor' | 'speedKph' | 'rangeKm'>;
}

export interface JitDecision {
  release: boolean;
  reason: ReleaseReason | null;
  releaseAt: Date;
  travelMin: number | null;
  predictedReadyAt: Date;
}

/** Road-adjusted travel minutes for a straight-line distance. */
export function travelMinutes(km: number, roadFactor: number, speedKph: number): number {
  return ((km * roadFactor) / speedKph) * 60;
}

/** Pure timing math + release conditions. */
export function decideJitRelease(i: JitDecisionInput): JitDecision {
  const predictedReadyAt = new Date(i.acceptedAt.getTime() + i.predictedPrepMin * MIN);
  const bufferMs = i.cfg.bufferMin * MIN;
  // No eligible rider close enough → invite now; far riders need the head start.
  if (i.nearestRiderKm == null || i.nearestRiderKm > i.cfg.rangeKm) {
    return { release: true, reason: 'no_rider_in_range', releaseAt: i.now, travelMin: null, predictedReadyAt };
  }
  const travelMin = travelMinutes(i.nearestRiderKm, i.cfg.roadFactor, i.cfg.speedKph);
  const releaseAt = new Date(predictedReadyAt.getTime() - travelMin * MIN - bufferMs);
  // Promise at risk: even with a rider waiting the moment food is ready, the
  // delivery leg + buffer already reaches the promise → no slack to hold.
  const deliveryLegMin = travelMinutes(i.deliveryKm ?? 0, i.cfg.roadFactor, i.cfg.speedKph);
  const bestCaseDeliveredAt = Math.max(predictedReadyAt.getTime(), i.now.getTime() + travelMin * MIN) + deliveryLegMin * MIN + bufferMs;
  if (bestCaseDeliveredAt >= i.promisedAt.getTime()) {
    return { release: true, reason: 'promise_at_risk', releaseAt, travelMin, predictedReadyAt };
  }
  if (i.now.getTime() >= releaseAt.getTime()) {
    return { release: true, reason: 'jit_due', releaseAt, travelMin, predictedReadyAt };
  }
  return { release: false, reason: null, releaseAt, travelMin, predictedReadyAt };
}

/** The delivery promise: the order's ETA when recorded, else placedAt + SLA. */
export function promisedAtFor(o: { estimatedDeliveryAt: Date | null; placedAt: Date }, slaMin: number): Date {
  return o.estimatedDeliveryAt ?? new Date(o.placedAt.getTime() + slaMin * MIN);
}

interface LatLng { lat: number; lng: number }

/** Nearest idle, online, approved rider allowed to take this restaurant's orders (km), or null. */
export async function nearestIdleRiderKm(
  pickup: LatLng,
  restaurant: { id: string; riderDispatchMode: RiderDispatchMode },
  rangeKm: number,
  now: Date = new Date(),
  /** Test isolation: only riders on the order's side count as supply. */
  isTestOrder = false
): Promise<number | null> {
  // Bounding box prefilter (2× range) so we never load every online rider.
  const dLat = (rangeKm * 2) / 111;
  const dLng = (rangeKm * 2) / (111 * Math.max(0.2, Math.cos((pickup.lat * Math.PI) / 180)));
  const typeFilter: Prisma.RiderProfileWhereInput =
    restaurant.riderDispatchMode === RiderDispatchMode.FLEET_ONLY
      ? { riderType: RiderType.FLEET }
      : restaurant.riderDispatchMode === RiderDispatchMode.DEDICATED_ONLY
        ? { riderType: RiderType.DEDICATED, dedicatedRestaurantId: restaurant.id }
        : { OR: [{ riderType: RiderType.FLEET }, { riderType: RiderType.DEDICATED, dedicatedRestaurantId: restaurant.id }] };
  const riders = await prisma.riderProfile.findMany({
    where: {
      isOnline: true,
      approvedAt: { not: null },
      updatedAt: { gte: new Date(now.getTime() - RIDER_FIX_MAX_AGE_MS) },
      currentLat: { gte: pickup.lat - dLat, lte: pickup.lat + dLat },
      currentLng: { gte: pickup.lng - dLng, lte: pickup.lng + dLng },
      assignments: { none: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] } } },
      ...typeFilter,
      ...riderTestSideFilter({ customer: { isTestAccount: isTestOrder } }),
    },
    select: { currentLat: true, currentLng: true },
    take: 200,
  });
  let best: number | null = null;
  for (const r of riders) {
    if (r.currentLat == null || r.currentLng == null) continue;
    const km = haversineKm({ lat: r.currentLat, lng: r.currentLng }, pickup);
    if (best == null || km < best) best = km;
  }
  return best;
}

const orderForJit = {
  id: true,
  status: true,
  fulfillmentType: true,
  placedAt: true,
  acceptedAt: true,
  estimatedDeliveryAt: true,
  scheduledFor: true,
  branchId: true,
  assignment: { select: { id: true } },
  customer: { select: { isTestAccount: true } },
  address: { select: { latitude: true, longitude: true } },
  branch: { select: { latitude: true, longitude: true, restaurant: { select: { id: true, riderDispatchMode: true } } } },
} satisfies Prisma.OrderSelect;
type OrderForJit = Prisma.OrderGetPayload<{ select: typeof orderForJit }>;

async function evaluate(order: OrderForJit, predictedPrepMin: number, acceptedAt: Date, cfg: DispatchJitConfig, now: Date): Promise<JitDecision> {
  const b = order.branch;
  const pickup = b.latitude != null && b.longitude != null ? { lat: b.latitude, lng: b.longitude } : null;
  const drop = order.address?.latitude != null && order.address?.longitude != null ? { lat: order.address.latitude, lng: order.address.longitude } : null;
  const nearest = pickup ? await nearestIdleRiderKm(pickup, b.restaurant, cfg.rangeKm, now, order.customer.isTestAccount) : null;
  return decideJitRelease({
    now,
    acceptedAt,
    predictedPrepMin,
    nearestRiderKm: nearest,
    deliveryKm: pickup && drop ? haversineKm(pickup, drop) : null,
    promisedAt: promisedAtFor(order, cfg.promiseSlaMin),
    cfg,
  });
}

/**
 * Offer a pre-ready order to riders through the existing flow (pool publish +
 * push). Single-winner on OrderDispatchPlan.releasedAt. Batch invitations stay
 * on the READY path (batch accept moves the order straight to OUT_FOR_DELIVERY).
 */
export async function releaseOrderToDispatch(orderId: string, reason: ReleaseReason, now: Date = new Date()): Promise<boolean> {
  const claimed = await prisma.orderDispatchPlan.updateMany({
    where: { orderId, releasedAt: null },
    data: { releasedAt: now, releaseReason: reason },
  });
  if (claimed.count === 0) return false;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, branchId: true, fulfillmentType: true, assignment: { select: { id: true } } },
  });
  if (!order || order.assignment || order.fulfillmentType !== FulfillmentType.DELIVERY) return true;
  if (!PRE_READY_STATUSES.includes(order.status)) return true;
  publish('rider:pool', { kind: 'order:new', orderId, branchId: order.branchId });
  const { notifyRidersOfNewOrder } = await import('../rider-push');
  notifyRidersOfNewOrder(orderId).catch(() => {});
  await recordOrderEvent({
    orderId,
    type: OrderEventType.INVITED,
    source: OrderEventSource.SYSTEM,
    at: now,
    dedupeKey: 'INVITED:pool',
    meta: { via: 'pool', reason, preReady: true },
  });
  return true;
}

/** Called after RECEIVED → ACCEPTED for a DELIVERY order. Never throws. */
export async function planDispatchOnAccept(orderId: string, now: Date = new Date()): Promise<void> {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: orderForJit });
    if (!order || order.fulfillmentType !== FulfillmentType.DELIVERY) return;
    const existing = await prisma.orderDispatchPlan.findUnique({ where: { orderId }, select: { orderId: true } });
    if (existing) return;
    const [pred, cfg] = await Promise.all([predictPrepMinutes(orderId), getJitConfig()]);
    const acceptedAt = order.acceptedAt ?? now;
    // Scheduled orders are accepted ahead of their slot; prep-from-accept would
    // be meaningless, so they keep the READY-triggered flow.
    const jitOn = cfg.enabled && !order.scheduledFor;
    const decision = jitOn ? await evaluate(order, pred.minutes, acceptedAt, cfg, now) : null;
    await prisma.orderDispatchPlan.create({
      data: {
        orderId,
        restaurantId: pred.restaurantId,
        predictedPrepMin: pred.minutes,
        prepSource: pred.source,
        prepSamples: pred.samples,
        acceptedAt,
        jit: jitOn,
        releaseAt: decision?.releaseAt ?? null,
      },
    });
    if (decision?.release && decision.reason) await releaseOrderToDispatch(orderId, decision.reason, now);
  } catch (e) {
    safeWarn({ err: (e as Error).message, orderId }, 'dispatch plan on accept failed');
  }
}

/**
 * Called when a DELIVERY order goes READY. Marks the plan released (reason
 * food_ready) if JIT had not already, records the pool INVITED event, and tells
 * the caller whether riders were already pushed (so it does not push twice).
 */
export async function onFoodReady(orderId: string, now: Date = new Date()): Promise<{ alreadyNotified: boolean }> {
  try {
    const plan = await prisma.orderDispatchPlan.findUnique({ where: { orderId }, select: { releasedAt: true } });
    const alreadyNotified = !!plan?.releasedAt;
    if (plan && !plan.releasedAt) {
      await prisma.orderDispatchPlan.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now, releaseReason: 'food_ready' } });
    }
    await recordOrderEvent({ orderId, type: OrderEventType.INVITED, source: OrderEventSource.SYSTEM, at: now, dedupeKey: 'INVITED:pool', meta: { via: 'pool', reason: 'food_ready' } });
    return { alreadyNotified };
  } catch (e) {
    safeWarn({ err: (e as Error).message, orderId }, 'dispatch onFoodReady failed');
    return { alreadyNotified: false };
  }
}

/** Ids of pre-ready orders JIT has released (for the rider pool + claim). Bounded window. */
export async function releasedPreReadyOrderIds(now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.orderDispatchPlan.findMany({
    where: { jit: true, releasedAt: { not: null }, createdAt: { gte: new Date(now.getTime() - PLAN_HORIZON_MS) } },
    select: { orderId: true },
    take: 500,
  });
  return rows.map((r) => r.orderId);
}

/** Is this specific pre-ready order released for riders? */
export async function isReleasedForDispatch(orderId: string): Promise<boolean> {
  const p = await prisma.orderDispatchPlan.findUnique({ where: { orderId }, select: { releasedAt: true } });
  return !!p?.releasedAt;
}

/** 1-minute job: release held orders whose time has come. No-op when JIT is off. */
export async function runJitReleaseSweep(now: Date = new Date()): Promise<{ enabled: boolean; held: number; released: number; byReason: Record<string, number> }> {
  const cfg = await getJitConfig();
  const byReason: Record<string, number> = {};
  if (!cfg.enabled) return { enabled: false, held: 0, released: 0, byReason };
  const plans = await prisma.orderDispatchPlan.findMany({
    where: { jit: true, releasedAt: null, createdAt: { gte: new Date(now.getTime() - PLAN_HORIZON_MS) } },
    select: { orderId: true, predictedPrepMin: true, acceptedAt: true, releaseAt: true },
    orderBy: { acceptedAt: 'asc' },
    take: 500,
  });
  if (plans.length === 0) return { enabled: true, held: 0, released: 0, byReason };
  const orders = await prisma.order.findMany({
    where: { id: { in: plans.map((p) => p.orderId) }, status: { in: PRE_READY_STATUSES }, fulfillmentType: FulfillmentType.DELIVERY, assignment: null },
    select: orderForJit,
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  let released = 0;
  let held = 0;
  for (const p of plans) {
    const order = byId.get(p.orderId);
    if (!order) continue; // READY (released by the READY hook), cancelled, or assigned
    const d = await evaluate(order, p.predictedPrepMin, p.acceptedAt, cfg, now);
    if (d.release && d.reason) {
      if (await releaseOrderToDispatch(p.orderId, d.reason, now)) {
        released++;
        byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      }
    } else {
      held++;
      if (!p.releaseAt || Math.abs(p.releaseAt.getTime() - d.releaseAt.getTime()) >= 30_000) {
        await prisma.orderDispatchPlan.update({ where: { orderId: p.orderId }, data: { releaseAt: d.releaseAt } });
      }
    }
  }
  return { enabled: true, held, released, byReason };
}
