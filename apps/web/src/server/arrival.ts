/**
 * Geofence arrival detection. When a rider ping lands within ARRIVAL_RADIUS_M
 * of the pickup (branch) or dropoff (delivery address), emit `rider_arrived`
 * once per order+phase: an OrderStatusEvent note (audit trail; the once-only guard is the unique RiderArrival row) and an SSE event on `order:{orderId}`.
 */
import { prisma } from './db';
import { publish } from './realtime';
import { haversineKm } from '@/lib/utils';

export type ArrivalPhase = 'pickup' | 'dropoff';
export interface LatLng { lat: number; lng: number }

const envRadius = Number(process.env.ARRIVAL_RADIUS_M);
export const ARRIVAL_RADIUS_M = Number.isFinite(envRadius) && envRadius > 0 ? envRadius : 120;

// `${orderId}:${phase}` — in-process fast path ONLY. The source of truth is the
// unique (orderId, phase) RiderArrival row, which dedupes across instances and
// restarts. Bounded so a long-lived process can't grow it without limit.
const FIRED_MAX = 5000;
const fired = new Set<string>();
export function __resetArrivalCache() { fired.clear(); }
function remember(key: string) {
  fired.add(key);
  if (fired.size > FIRED_MAX) {
    const oldest = fired.values().next().value;
    if (oldest !== undefined) fired.delete(oldest);
  }
}

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
    remember(key); // claim synchronously so concurrent pings in this process can't double-fire
    try {
      // Durable, concurrency-safe once-only claim across instances. A unique
      // conflict (P2002) means another ping/instance already fired this phase.
      try {
        await prisma.riderArrival.create({ data: { orderId, phase } });
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'P2002') continue; // already fired; emit nothing
        throw e;
      }
      // Emit ONLY after a successful claim.
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (order) {
        await prisma.orderStatusEvent.create({ data: { orderId, status: order.status, note: `rider_arrived:${phase}` } });
      }
      publish(`order:${orderId}`, { kind: 'rider_arrived', orderId, phase, at: new Date().toISOString() });
    } catch {
      fired.delete(key); // claim failed (transient error): allow retry on next ping
    }
  }
}
