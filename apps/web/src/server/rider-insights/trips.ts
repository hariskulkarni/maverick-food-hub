/**
 * Per-delivery path summaries (RiderTripSummary), reconstructed from the
 * order-tagged DeliveryLocationPing trail of a DELIVERED assignment.
 *
 * Filled by the rider-trip-summaries job (every 10 min, for assignments
 * delivered ≥ SETTLE_MS ago so late offline-queue batches have landed), by the
 * insights path view (recomputed on open), and by the retention job before raw
 * pings are pruned. Summaries hold no coordinates and are kept after pruning.
 */
import { prisma } from '../db';
import { reconstructPath, type PathPoint, type PathSummary } from './path';

/** Background location batches may arrive a little after hand-over. */
export const SETTLE_MS = 10 * 60_000;
export const MAX_TRIP_POINTS = 5000;

export async function loadTripPoints(riderId: string, orderId: string): Promise<PathPoint[]> {
  const rows = await prisma.deliveryLocationPing.findMany({
    where: { riderId, orderId },
    orderBy: { createdAt: 'asc' },
    take: MAX_TRIP_POINTS,
    select: { lat: true, lng: true, speedKph: true, createdAt: true },
  });
  return rows.map((r) => ({ lat: r.lat, lng: r.lng, speedKph: r.speedKph, t: r.createdAt.getTime() }));
}

export function summaryRow(a: { id: string; riderId: string; orderId: string }, s: PathSummary) {
  return {
    assignmentId: a.id,
    riderId: a.riderId,
    orderId: a.orderId,
    pointCount: s.pointCount,
    droppedPoints: s.droppedPoints,
    distanceM: s.distanceM,
    durationSec: Math.round(s.durationMs / 1000),
    movingSec: Math.round(s.movingMs / 1000),
    maxGapSec: Math.round(s.maxGapMs / 1000),
    gapCount: s.gapCount,
    startedAt: s.startedAt !== null ? new Date(s.startedAt) : null,
    endedAt: s.endedAt !== null ? new Date(s.endedAt) : null,
    computedAt: new Date(),
  };
}

export async function storeTripSummary(a: { id: string; riderId: string; orderId: string }, s: PathSummary) {
  const data = summaryRow(a, s);
  const { assignmentId, ...rest } = data;
  await prisma.riderTripSummary.upsert({ where: { assignmentId }, create: data, update: rest });
}

/** Summarise up to `limit` delivered assignments that have no summary yet (newest first). */
export async function runTripSummaries(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const pending = await prisma.riderAssignment.findMany({
    where: { status: 'DELIVERED', deliveredAt: { lte: new Date(now.getTime() - SETTLE_MS) }, tripSummary: { is: null } },
    orderBy: { deliveredAt: 'desc' },
    take: opts.limit ?? 200,
    select: { id: true, riderId: true, orderId: true },
  });
  let summarized = 0;
  for (const a of pending) {
    try {
      await storeTripSummary(a, reconstructPath(await loadTripPoints(a.riderId, a.orderId)));
      summarized++;
    } catch {
      // one bad row must not stop the batch
    }
  }
  return { pending: pending.length, summarized };
}
