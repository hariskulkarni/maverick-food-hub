/**
 * Online-time / idle-time math over RiderStatusEvent rows. Pure.
 *
 * State machine: ONLINE, SIGNAL_LOST and SIGNAL_REGAINED leave the rider
 * online (a signal-lost rider is kept online mid-delivery); OFFLINE and
 * AUTO_OFFLINE end the online interval.
 *
 * The state at the window start is the state after the last event before it.
 * With no earlier event the rider is assumed OFFLINE (history starts when this
 * feature shipped — never invent online time). An interval still open at the
 * end is closed at `openUntil` (now when the rider is online, else the last
 * time the app was heard from).
 */
import { avgSpeedKph, reconstructPath, type PathPoint } from './path';

export type StatusType = 'ONLINE' | 'OFFLINE' | 'AUTO_OFFLINE' | 'SIGNAL_LOST' | 'SIGNAL_REGAINED';

export interface StatusEventLite {
  type: StatusType;
  at: Date;
}

export type Interval = [number, number];

export const isOnlineState = (t: StatusType) => t === 'ONLINE' || t === 'SIGNAL_LOST' || t === 'SIGNAL_REGAINED';

export function onlineIntervals(
  eventsAsc: StatusEventLite[],
  windowStart: number,
  windowEnd: number,
  openUntil: number,
  stateBefore: StatusType | null
): Interval[] {
  const out: Interval[] = [];
  let online = stateBefore ? isOnlineState(stateBefore) : false;
  let since = windowStart;
  for (const e of eventsAsc) {
    const t = e.at.getTime();
    if (t < windowStart) { online = isOnlineState(e.type); continue; }
    if (t > windowEnd) break;
    const next = isOnlineState(e.type);
    if (online && !next) { if (t > since) out.push([since, t]); }
    else if (!online && next) since = t;
    online = next;
  }
  if (online) {
    const end = Math.min(windowEnd, Math.max(openUntil, since));
    if (end > since) out.push([since, end]);
  }
  return out;
}

export function totalMs(intervals: Interval[]): number {
  return intervals.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
}

/** Merge overlapping intervals (input any order). */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Total overlap between two interval sets. */
export function overlapMs(a: Interval[], b: Interval[]): number {
  const ua = unionIntervals(a);
  const ub = unionIntervals(b);
  let i = 0, j = 0, sum = 0;
  while (i < ua.length && j < ub.length) {
    const lo = Math.max(ua[i][0], ub[j][0]);
    const hi = Math.min(ua[i][1], ub[j][1]);
    if (hi > lo) sum += hi - lo;
    if (ua[i][1] < ub[j][1]) i++; else j++;
  }
  return sum;
}

/** Online time not spent on an accepted delivery. */
export function idleMs(online: Interval[], deliveries: Interval[]): number {
  return Math.max(0, totalMs(unionIntervals(online)) - overlapMs(online, deliveries));
}

// ── Window stats (today / 7 days) ───────────────────────────────────────────

export interface DeliveryLite {
  /** Accepted (or claimed/assigned) time, ms. */
  start: number;
  /** Delivered time, ms — or now for a delivery still in progress; null if it never completed. */
  end: number | null;
  deliveredAt: number | null;
}

export interface WindowStats {
  onlineMs: number;
  idleMs: number;
  deliveries: number;
  distanceM: number;
  movingMs: number;
  avgSpeedKph: number;
  signalLost: number;
  autoOffline: number;
}

export function windowStats(input: {
  start: number;
  end: number;
  openUntil: number;
  stateBefore: StatusType | null;
  eventsAsc: StatusEventLite[];
  deliveries: DeliveryLite[];
  pings: PathPoint[];
}): WindowStats {
  const { start, end } = input;
  const inWindow = input.eventsAsc.filter((e) => e.at.getTime() >= start && e.at.getTime() <= end);
  // State just before the window: last event before it, else the caller's.
  const before = input.eventsAsc.filter((e) => e.at.getTime() < start);
  const stateBefore = before.length ? before[before.length - 1].type : input.stateBefore;
  const online = onlineIntervals(inWindow, start, end, input.openUntil, stateBefore);
  const deliveryIntervals: Interval[] = input.deliveries
    .filter((d) => d.end !== null)
    .map((d) => [Math.max(start, d.start), Math.min(end, d.end as number)] as Interval)
    .filter(([a, b]) => b > a);
  const path = reconstructPath(input.pings.filter((p) => p.t >= start && p.t <= end));
  return {
    onlineMs: totalMs(online),
    idleMs: idleMs(online, deliveryIntervals),
    deliveries: input.deliveries.filter((d) => d.deliveredAt !== null && d.deliveredAt >= start && d.deliveredAt <= end).length,
    distanceM: path.distanceM,
    movingMs: path.movingMs,
    avgSpeedKph: avgSpeedKph(path.distanceM, path.movingMs),
    signalLost: inWindow.filter((e) => e.type === 'SIGNAL_LOST').length,
    autoOffline: inWindow.filter((e) => e.type === 'AUTO_OFFLINE').length,
  };
}
