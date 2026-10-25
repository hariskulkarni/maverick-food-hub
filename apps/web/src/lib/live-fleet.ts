/**
 * Live fleet model — pure, client-safe helpers shared by the server snapshot
 * (/platform/live, /admin/live, GET /api/platform/riders/live) and the live
 * map client. Keeping one derivation means the first paint, the 4 s poll and
 * the SSE stream can never disagree about what a rider is doing.
 *
 * Two different times per rider:
 *   - `at`     — when the plotted GPS fix was taken (RiderHeartbeat.lastLocationAt,
 *                which only moves together with RiderProfile.currentLat/Lng).
 *   - `seenAt` — the last time the app talked to us at all (heartbeat or any
 *                location batch). Drives "signal lost".
 */
import { computeEta } from '@/server/eta';

/** Same window the auto-offline sweep uses (server/rider-heartbeat.ts). */
export const RIDER_SIGNAL_STALE_MS = 2 * 60 * 1000;

export type FleetStatus = 'IDLE' | 'PENDING' | 'ACCEPTED' | 'PICKED_UP';

export interface LatLng { lat: number; lng: number }

export interface FleetRider {
  riderId: string;
  name?: string;
  lat: number;
  lng: number;
  /** ISO time of the plotted GPS fix. */
  at: string;
  /** ISO time the app was last heard from. */
  seenAt?: string;
  /** True when the app has been silent longer than RIDER_SIGNAL_STALE_MS. */
  stale?: boolean;
  status?: FleetStatus;
  /** Order the rider is working on (the most advanced leg). */
  orderId?: string;
  /** Number of active (offered / accepted / picked-up) orders. */
  activeOrders?: number;
  /** Where the current leg ends: restaurant before pickup, customer after. */
  dest?: LatLng | null;
  speedKph?: number;
}

/** Order statuses that end a delivery — mirrors rider-location-points.ts. */
const CLOSED_ORDER_STATUSES = new Set([
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_ADMIN',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
]);

const RANK: Record<FleetStatus, number> = { IDLE: 0, PENDING: 1, ACCEPTED: 2, PICKED_UP: 3 };

export interface AssignmentInput {
  status: string; // AssignmentStatus
  assignedAt?: Date | string | null;
  order: {
    id: string;
    status: string; // OrderStatus
    branch?: { latitude: number | null; longitude: number | null } | null;
    address?: { latitude: number | null; longitude: number | null } | null;
  };
}

export interface RiderInput {
  id: string;
  name?: string | null;
  currentLat: number | null;
  currentLng: number | null;
  updatedAt: Date;
  heartbeat?: { lastSeenAt: Date | null; lastLocationAt: Date | null } | null;
  assignments: AssignmentInput[];
}

function pt(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  return lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null;
}

/** An assignment still in play: offered, or accepted/picked-up on an open order. */
export function isLiveAssignment(a: AssignmentInput): boolean {
  if (CLOSED_ORDER_STATUSES.has(a.order.status)) return false;
  return a.status === 'PENDING' || a.status === 'ACCEPTED' || a.status === 'PICKED_UP';
}

export function isStale(seenAt: string | Date | undefined | null, now: number): boolean {
  if (!seenAt) return true;
  return now - new Date(seenAt).getTime() > RIDER_SIGNAL_STALE_MS;
}

/** Build the live view of one rider, or null when there is no position to plot. */
export function deriveRiderLive(r: RiderInput, now: number): FleetRider | null {
  if (r.currentLat == null || r.currentLng == null) return null;
  const at = (r.heartbeat?.lastLocationAt ?? r.updatedAt).toISOString();
  const seen = r.heartbeat?.lastSeenAt ?? r.heartbeat?.lastLocationAt ?? null;
  const seenAt = seen ? seen.toISOString() : at;

  const live = r.assignments.filter(isLiveAssignment);
  let lead: AssignmentInput | undefined;
  for (const a of live) {
    const rank = RANK[a.status as FleetStatus] ?? 0;
    const leadRank = lead ? RANK[lead.status as FleetStatus] ?? 0 : -1;
    const newer = lead && rank === leadRank
      && new Date(a.assignedAt ?? 0).getTime() > new Date(lead.assignedAt ?? 0).getTime();
    if (rank > leadRank || newer) lead = a;
  }

  let dest: LatLng | null = null;
  if (lead?.status === 'PICKED_UP') dest = pt(lead.order.address?.latitude, lead.order.address?.longitude);
  else if (lead?.status === 'ACCEPTED') dest = pt(lead.order.branch?.latitude, lead.order.branch?.longitude);
  // PENDING (offer not accepted yet): no leg in progress, so no ETA.

  return {
    riderId: r.id,
    name: r.name ?? 'Rider',
    lat: Number(r.currentLat),
    lng: Number(r.currentLng),
    at,
    seenAt,
    stale: isStale(seenAt, now),
    status: (lead?.status as FleetStatus | undefined) ?? 'IDLE',
    orderId: lead?.order.id,
    activeOrders: live.length,
    dest,
  };
}

export interface FleetStats {
  /** Riders with a live signal. */
  online: number;
  /** Riders whose app has gone quiet (still shown, greyed). */
  signalLost: number;
  idle: number;
  headingToPickup: number;
  onDelivery: number;
  /** Average minutes to the end of the current leg, fresh riders only. */
  avgEta: number | null;
}

export function computeFleetStats(riders: FleetRider[], now: number): FleetStats {
  let online = 0, signalLost = 0, idle = 0, headingToPickup = 0, onDelivery = 0;
  const etas: number[] = [];
  for (const r of riders) {
    const stale = isStale(r.seenAt ?? r.at, now);
    if (stale) signalLost++;
    else online++;
    const s = r.status ?? 'IDLE';
    if (s === 'PICKED_UP') onDelivery++;
    else if (s === 'ACCEPTED' || s === 'PENDING') headingToPickup++;
    else if (!stale) idle++;
    if (!stale && r.dest) {
      const m = computeEta({ lat: r.lat, lng: r.lng }, r.dest);
      if (m != null) etas.push(m);
    }
  }
  const avgEta = etas.length ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length) : null;
  return { online, signalLost, idle, headingToPickup, onDelivery, avgEta };
}

/**
 * Merge a polled row into what the map already shows. Workflow fields
 * (status, leg, order) come from the poll — it is the authority. The position
 * never rewinds: if the map already holds a newer fix (from SSE), keep it.
 */
export function mergePolled(prev: FleetRider | undefined, row: FleetRider): FleetRider {
  if (!prev) return row;
  const prevNewer = new Date(prev.at).getTime() > new Date(row.at).getTime();
  const seenAt = latestIso(prev.seenAt, row.seenAt);
  return {
    ...prev,
    ...row,
    lat: prevNewer ? prev.lat : row.lat,
    lng: prevNewer ? prev.lng : row.lng,
    at: prevNewer ? prev.at : row.at,
    speedKph: prevNewer ? prev.speedKph : row.speedKph,
    seenAt,
    name: row.name ?? prev.name,
  };
}

/** Apply an SSE `rider:position` event. Out-of-order frames never rewind the pin. */
export function mergeSse(
  prev: FleetRider | undefined,
  e: { riderId: string; lat: number; lng: number; at: string; speedKph?: number; name?: string },
): FleetRider | null {
  if (prev && new Date(e.at).getTime() < new Date(prev.at).getTime()) return null;
  return {
    ...(prev ?? { riderId: e.riderId, status: 'IDLE' as FleetStatus }),
    riderId: e.riderId,
    lat: e.lat,
    lng: e.lng,
    at: e.at,
    speedKph: e.speedKph,
    seenAt: latestIso(prev?.seenAt, e.at),
    stale: false,
    name: e.name ?? prev?.name,
  };
}

function latestIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** "just now" / "45s ago" / "3m ago" / "2h ago". */
export function formatAgo(iso: string | undefined, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
