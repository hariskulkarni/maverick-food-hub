/**
 * Geofence arrival detection. When a rider ping lands within ARRIVAL_RADIUS_M
 * of the pickup (branch) or dropoff (delivery address), emit `rider_arrived`
 * once per order+phase: an OrderStatusEvent note (durable idempotency marker,
 * `rider_arrived:<phase>`) and an SSE event on `order:{orderId}`.
 */
import { prisma } from './db';
import { publish } from './realtime';
import { haversineKm } from '@/lib/utils';

export type ArrivalPhase = 'pickup' | 'dropoff';
export interface LatLng { lat: number; lng: number }

const envRadius = Number(process.env.ARRIVAL_RADIUS_M);
export const ARRIVAL_RADIUS_M = Number.isFinite(envRadius) && envRadius > 0 ? envRadius : 120;

const fired = new Set<string>(); // `${orderId}:${phase}` — in-process fast path
export function __resetArrivalCache() { fired.clear(); }

export function arrivedPhases(
  rider: LatLng,
  pickup: LatLng | null | undefined,
  drop: LatLng | null | undefined,
  radiusM: number = ARRIVAL_RADIUS_M
): ArrivalPhase[] {
  const out: ArrivalPhase[] = [];
  if (pickup && haversineKm(rider, pickup) * 1000 <= radiusM) out.push('pickup');
  if (drop && haversineKm(rider, drop) * 1000 <= radiusM) out.push('dropoff');
  return out;
}

export async function maybeEmitArrival(
  orderId: string,
  rider: LatLng,
  pickup: LatLng | null | undefined,
  drop: LatLng | null | undefined
): Promise<void> {
  for (const phase of arrivedPhases(rider, pickup, drop)) {
    const key = `${orderId}:${phase}`;
    if (fired.has(key)) continue;
    fired.add(key); // claim synchronously so concurrent pings can't double-fire
    try {
      const note = `rider_arrived:${phase}`;
      const existing = await prisma.orderStatusEvent.findFirst({ where: { orderId, note }, select: { id: true } });
      if (existing) continue;
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!order) continue;
      await prisma.orderStatusEvent.create({ data: { orderId, status: order.status, note } });
      publish(`order:${orderId}`, { kind: 'rider_arrived', orderId, phase, at: new Date().toISOString() });
    } catch {
      fired.delete(key); // allow retry on next ping
    }
  }
}
