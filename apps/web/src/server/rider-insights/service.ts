/**
 * Data loaders for the super-admin rider insights page
 * (/platform/riders/[id]/insights). All return plain DTOs.
 */
import { prisma } from '../db';
import { addDaysToKey, istDayKey, istStartOfDay } from '@/lib/ist';
import { RIDER_SIGNAL_STALE_MS } from '@/lib/live-fleet';
import { downsample, reconstructPath, type PathPoint } from './path';
import { windowStats, type DeliveryLite, type StatusType } from './stats';
import { loadTripPoints, storeTripSummary } from './trips';
import { getRiderIntegrity } from '../rider-integrity/service';

/** Pings loaded for the 7-day stats (a rider online 12 h/day at one per ~15 s is ~20k). */
export const STATS_MAX_PINGS = 60_000;
export const PATH_MAX_DISPLAY_POINTS = 1500;
export const SHIFT_PATH_MAX_MS = 24 * 3_600_000;

export function insightWindows(now: Date) {
  const today = istStartOfDay(istDayKey(now)).getTime();
  const week = istStartOfDay(addDaysToKey(istDayKey(now), -6)).getTime();
  return { today, week, now: now.getTime() };
}

function deliveryLite(a: {
  status: string;
  assignedAt: Date;
  claimedAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
}, now: number): DeliveryLite {
  const start = (a.acceptedAt ?? a.claimedAt ?? a.assignedAt).getTime();
  const active = a.status === 'ACCEPTED' || a.status === 'PICKED_UP';
  const deliveredAt = a.deliveredAt ? a.deliveredAt.getTime() : null;
  return { start, end: deliveredAt ?? (active ? now : null), deliveredAt };
}

export async function getRiderInsights(riderId: string, nowDate: Date = new Date()) {
  const { today, week, now } = insightWindows(nowDate);
  const rider = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    select: {
      id: true,
      isOnline: true,
      currentLat: true,
      currentLng: true,
      vehicleType: true,
      vehicleNumber: true,
      approvedAt: true,
      user: { select: { name: true, phone: true } },
      branch: { select: { name: true } },
    },
  });
  if (!rider) return null;

  const weekStart = new Date(week);
  const [heartbeat, device, lastPing, stateBeforeRow, events, assignments, pings, samples] = await Promise.all([
    prisma.riderHeartbeat.findUnique({ where: { riderId } }),
    prisma.riderDeviceSnapshot.findUnique({ where: { riderId } }),
    prisma.deliveryLocationPing.findFirst({
      where: { riderId },
      orderBy: { createdAt: 'desc' },
      select: { lat: true, lng: true, speedKph: true, createdAt: true, orderId: true },
    }),
    prisma.riderStatusEvent.findFirst({ where: { riderId, at: { lt: weekStart } }, orderBy: { at: 'desc' }, select: { type: true } }),
    prisma.riderStatusEvent.findMany({
      where: { riderId, at: { gte: weekStart } },
      orderBy: { at: 'asc' },
      take: 5000,
      select: { id: true, type: true, source: true, at: true },
    }),
    prisma.riderAssignment.findMany({
      where: {
        riderId,
        OR: [{ deliveredAt: { gte: weekStart } }, { assignedAt: { gte: weekStart } }, { status: { in: ['ACCEPTED', 'PICKED_UP'] } }],
      },
      orderBy: { assignedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        status: true,
        assignedAt: true,
        claimedAt: true,
        acceptedAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        order: { select: { id: true, code: true, status: true, branch: { select: { name: true } } } },
        tripSummary: true,
      },
    }),
    prisma.deliveryLocationPing.findMany({
      where: { riderId, createdAt: { gte: weekStart } },
      orderBy: { createdAt: 'asc' },
      take: STATS_MAX_PINGS,
      select: { lat: true, lng: true, speedKph: true, createdAt: true },
    }),
    prisma.riderDeviceSample.findMany({
      where: { riderId, capturedAt: { gte: weekStart } },
      orderBy: { capturedAt: 'desc' },
      take: 50,
    }),
  ]);

  const points: PathPoint[] = pings.map((p) => ({ lat: p.lat, lng: p.lng, speedKph: p.speedKph, t: p.createdAt.getTime() }));
  const deliveries = assignments.map((a) => deliveryLite(a, now));
  const lastSeen = heartbeat?.lastSeenAt?.getTime() ?? null;
  // An interval still open is closed at now for an online rider, else at the
  // last time the app was heard from (never invents online time).
  const openUntil = rider.isOnline ? now : lastSeen ?? 0;
  const eventsAsc = events.map((e) => ({ type: e.type as StatusType, at: e.at }));
  const stateBefore = (stateBeforeRow?.type as StatusType | undefined) ?? null;
  const common = { end: now, openUntil, stateBefore, eventsAsc, deliveries, pings: points };

  const signalLost = !!heartbeat?.signalLostAt || (rider.isOnline && (lastSeen === null || now - lastSeen > RIDER_SIGNAL_STALE_MS));

  // Location-integrity (anti-fraud): suspicion events, mock-ping count, device
  // attestation verdict and the review state. See server/rider-integrity.
  const integrity = await getRiderIntegrity(riderId);

  return {
    integrity,
    rider: {
      id: rider.id,
      name: rider.user.name,
      phone: rider.user.phone,
      vehicleType: rider.vehicleType,
      vehicleNumber: rider.vehicleNumber,
      branch: rider.branch?.name ?? null,
      approved: !!rider.approvedAt,
    },
    status: {
      isOnline: rider.isOnline,
      signalLost,
      signalLostAt: heartbeat?.signalLostAt?.toISOString() ?? null,
      lastSeenAt: heartbeat?.lastSeenAt?.toISOString() ?? null,
      lastLocationAt: heartbeat?.lastLocationAt?.toISOString() ?? null,
      gpsEnabled: heartbeat?.gpsEnabled ?? null,
    },
    lastLocation:
      lastPing
        ? { lat: lastPing.lat, lng: lastPing.lng, speedKph: lastPing.speedKph, at: lastPing.createdAt.toISOString(), orderId: lastPing.orderId }
        : rider.currentLat != null && rider.currentLng != null
          ? { lat: rider.currentLat, lng: rider.currentLng, speedKph: null, at: heartbeat?.lastLocationAt?.toISOString() ?? null, orderId: null }
          : null,
    device: device
      ? {
          model: device.deviceModel,
          osName: device.osName,
          osVersion: device.osVersion,
          appVersion: device.appVersion,
          appBuild: device.appBuild,
          networkType: device.networkType,
          cellularGeneration: device.cellularGeneration,
          batteryLevel: device.batteryLevel,
          charging: device.charging,
          capturedAt: device.capturedAt.toISOString(),
        }
      : null,
    deviceHistory: samples.map((s) => ({
      at: s.capturedAt.toISOString(),
      networkType: s.networkType,
      cellularGeneration: s.cellularGeneration,
      batteryLevel: s.batteryLevel,
      charging: s.charging,
      appVersion: s.appVersion,
    })),
    stats: {
      today: windowStats({ ...common, start: today }),
      week: windowStats({ ...common, start: week }),
      pingsTruncated: pings.length >= STATS_MAX_PINGS,
    },
    timeline: events
      .slice()
      .reverse()
      .slice(0, 300)
      .map((e) => ({ id: e.id, type: e.type, source: e.source, at: e.at.toISOString() })),
    deliveries: assignments.slice(0, 100).map((a) => ({
      assignmentId: a.id,
      orderId: a.order.id,
      orderCode: a.order.code,
      branch: a.order.branch?.name ?? null,
      status: a.status,
      acceptedAt: (a.acceptedAt ?? a.claimedAt ?? a.assignedAt).toISOString(),
      pickedUpAt: a.pickedUpAt?.toISOString() ?? null,
      deliveredAt: a.deliveredAt?.toISOString() ?? null,
      summary: a.tripSummary
        ? {
            distanceM: a.tripSummary.distanceM,
            durationSec: a.tripSummary.durationSec,
            maxGapSec: a.tripSummary.maxGapSec,
            pointCount: a.tripSummary.pointCount,
          }
        : null,
    })),
    generatedAt: new Date(now).toISOString(),
  };
}

export type RiderInsightsDTO = NonNullable<Awaited<ReturnType<typeof getRiderInsights>>>;

/** Path for one delivery of this rider; refreshes its stored summary when delivered. */
export async function getDeliveryPath(riderId: string, assignmentId: string) {
  const a = await prisma.riderAssignment.findFirst({
    where: { id: assignmentId, riderId },
    select: {
      id: true,
      riderId: true,
      orderId: true,
      status: true,
      acceptedAt: true,
      claimedAt: true,
      assignedAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      order: {
        select: {
          code: true,
          branch: { select: { name: true, latitude: true, longitude: true } },
          address: { select: { latitude: true, longitude: true } },
        },
      },
    },
  });
  if (!a) return null;
  const summary = reconstructPath(await loadTripPoints(a.riderId, a.orderId));
  if (a.status === 'DELIVERED') await storeTripSummary(a, summary).catch(() => {});
  const b = a.order.branch;
  const addr = a.order.address;
  return {
    kind: 'delivery' as const,
    assignmentId: a.id,
    orderCode: a.order.code,
    status: a.status,
    milestones: {
      acceptedAt: (a.acceptedAt ?? a.claimedAt ?? a.assignedAt).toISOString(),
      pickedUpAt: a.pickedUpAt?.toISOString() ?? null,
      deliveredAt: a.deliveredAt?.toISOString() ?? null,
    },
    pickup: b?.latitude != null && b?.longitude != null ? { lat: Number(b.latitude), lng: Number(b.longitude), name: b.name } : null,
    drop: addr?.latitude != null && addr?.longitude != null ? { lat: Number(addr.latitude), lng: Number(addr.longitude) } : null,
    ...pathDto(summary),
  };
}

/** Shift path: every ping of this rider between `from` and `to` (≤ 24 h). */
export async function getShiftPath(riderId: string, from: Date, to: Date) {
  const rows = await prisma.deliveryLocationPing.findMany({
    where: { riderId, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'asc' },
    take: STATS_MAX_PINGS,
    select: { lat: true, lng: true, speedKph: true, createdAt: true },
  });
  const summary = reconstructPath(rows.map((r) => ({ lat: r.lat, lng: r.lng, speedKph: r.speedKph, t: r.createdAt.getTime() })));
  return { kind: 'shift' as const, from: from.toISOString(), to: to.toISOString(), pickup: null, drop: null, ...pathDto(summary) };
}

function pathDto(s: ReturnType<typeof reconstructPath>) {
  return {
    summary: {
      pointCount: s.pointCount,
      droppedPoints: s.droppedPoints,
      distanceM: s.distanceM,
      durationSec: Math.round(s.durationMs / 1000),
      movingSec: Math.round(s.movingMs / 1000),
      maxGapSec: Math.round(s.maxGapMs / 1000),
      gapCount: s.gapCount,
      startedAt: s.startedAt !== null ? new Date(s.startedAt).toISOString() : null,
      endedAt: s.endedAt !== null ? new Date(s.endedAt).toISOString() : null,
    },
    points: downsample(s.points, PATH_MAX_DISPLAY_POINTS).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, speedKph: p.speedKph ?? null })),
  };
}
