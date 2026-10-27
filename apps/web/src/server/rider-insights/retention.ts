/**
 * Retention for rider insights data (DPDP data minimisation), run daily from
 * the obs-retention job (src/server/observability/retention.ts):
 *   GPS breadcrumbs (DeliveryLocationPing) 90d · status events 90d ·
 *   device history 30d · a latest device snapshot not refreshed for 90d.
 * Per-delivery trip summaries (no coordinates) are kept; pending ones are
 * computed first so a delivery's summary survives its raw pings.
 */
import { prisma } from '../db';
import { runTripSummaries } from './trips';

export const RIDER_INSIGHTS_RETENTION_DAYS = {
  breadcrumbs: 90,
  statusEvents: 90,
  deviceSamples: 30,
  deviceSnapshot: 90,
} as const;

/** Pings are deleted in chunks so the first run on a large table never holds one huge delete. */
export const PING_DELETE_BATCH = 5000;
export const PING_DELETE_MAX_BATCHES = 200;

const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 86_400_000);

export async function runRiderInsightsRetention(now: Date = new Date()) {
  const trips = await runTripSummaries({ limit: 1000, now });

  const [events, samples, snapshots] = await Promise.all([
    prisma.riderStatusEvent.deleteMany({ where: { at: { lt: daysAgo(now, RIDER_INSIGHTS_RETENTION_DAYS.statusEvents) } } }),
    prisma.riderDeviceSample.deleteMany({ where: { capturedAt: { lt: daysAgo(now, RIDER_INSIGHTS_RETENTION_DAYS.deviceSamples) } } }),
    prisma.riderDeviceSnapshot.deleteMany({ where: { capturedAt: { lt: daysAgo(now, RIDER_INSIGHTS_RETENTION_DAYS.deviceSnapshot) } } }),
  ]);

  const pingCutoff = daysAgo(now, RIDER_INSIGHTS_RETENTION_DAYS.breadcrumbs);
  let pings = 0;
  for (let i = 0; i < PING_DELETE_MAX_BATCHES; i++) {
    const n = await prisma.$executeRaw`
      DELETE FROM "DeliveryLocationPing"
      WHERE id IN (SELECT id FROM "DeliveryLocationPing" WHERE "createdAt" < ${pingCutoff} LIMIT ${PING_DELETE_BATCH})`;
    pings += n;
    if (n < PING_DELETE_BATCH) break;
  }

  return {
    tripSummaries: trips.summarized,
    deleted: { breadcrumbs: pings, statusEvents: events.count, deviceSamples: samples.count, deviceSnapshots: snapshots.count },
  };
}
