/**
 * GET /api/platform/riders/[id]/insights/export?kind=…&from=ISO&to=ISO → CSV
 *   kind = timeline | breadcrumbs | deliveries | device
 *   Range defaults to the last 7 days; at most 31 days. Every export is audited.
 *
 * Auth: riders:read.
 */
import { NextRequest } from 'next/server';
import { requireCapabilityApi } from '@/server/api-auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { csvResponse } from '@/server/reports/csv';
import { formatIst } from '@/lib/ist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['timeline', 'breadcrumbs', 'deliveries', 'device'] as const;
type Kind = (typeof KINDS)[number];
const MAX_RANGE_MS = 31 * 86_400_000;
const MAX_ROWS = 50_000;

const ist = (d: Date | null | undefined) => (d ? formatIst(d, { dateStyle: 'short', timeStyle: 'medium' }) : '');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('riders:read');
  if (gate instanceof Response) return gate;
  const session = gate;
  const { id } = await params;
  const sp = req.nextUrl.searchParams;

  const kind = sp.get('kind') as Kind;
  if (!KINDS.includes(kind)) return Response.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
  const to = sp.get('to') ? new Date(sp.get('to')!) : new Date();
  const from = sp.get('from') ? new Date(sp.get('from')!) : new Date(to.getTime() - 7 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return Response.json({ error: 'from/to must be valid ISO timestamps with from < to' }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) return Response.json({ error: 'Export range is at most 31 days' }, { status: 400 });

  const rider = await prisma.riderProfile.findUnique({ where: { id }, select: { id: true } });
  if (!rider) return Response.json({ error: 'Rider not found' }, { status: 404 });

  let headers: string[];
  let rows: unknown[][];
  if (kind === 'timeline') {
    const ev = await prisma.riderStatusEvent.findMany({
      where: { riderId: id, at: { gte: from, lte: to } },
      orderBy: { at: 'asc' },
      take: MAX_ROWS,
    });
    headers = ['at_utc', 'at_ist', 'event', 'source'];
    rows = ev.map((e) => [e.at, ist(e.at), e.type, e.source ?? '']);
  } else if (kind === 'breadcrumbs') {
    const pings = await prisma.deliveryLocationPing.findMany({
      where: { riderId: id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
      select: { createdAt: true, lat: true, lng: true, speedKph: true, orderId: true },
    });
    headers = ['at_utc', 'at_ist', 'lat', 'lng', 'speed_kph', 'order_id'];
    rows = pings.map((p) => [p.createdAt, ist(p.createdAt), p.lat, p.lng, p.speedKph ?? '', p.orderId ?? '']);
  } else if (kind === 'deliveries') {
    const as = await prisma.riderAssignment.findMany({
      where: { riderId: id, assignedAt: { gte: from, lte: to } },
      orderBy: { assignedAt: 'asc' },
      take: MAX_ROWS,
      select: {
        status: true,
        assignedAt: true,
        acceptedAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        order: { select: { code: true } },
        tripSummary: true,
      },
    });
    headers = ['order', 'status', 'assigned_ist', 'accepted_ist', 'picked_up_ist', 'delivered_ist', 'distance_km', 'duration_min', 'moving_min', 'max_gap_sec', 'gps_points'];
    rows = as.map((a) => {
      const s = a.tripSummary;
      return [
        a.order.code,
        a.status,
        ist(a.assignedAt),
        ist(a.acceptedAt),
        ist(a.pickedUpAt),
        ist(a.deliveredAt),
        s ? (s.distanceM / 1000).toFixed(2) : '',
        s ? (s.durationSec / 60).toFixed(1) : '',
        s ? (s.movingSec / 60).toFixed(1) : '',
        s ? s.maxGapSec : '',
        s ? s.pointCount : '',
      ];
    });
  } else {
    const samples = await prisma.riderDeviceSample.findMany({
      where: { riderId: id, capturedAt: { gte: from, lte: to } },
      orderBy: { capturedAt: 'asc' },
      take: MAX_ROWS,
    });
    headers = ['at_utc', 'at_ist', 'model', 'os', 'os_version', 'app_version', 'app_build', 'network', 'cell_generation', 'battery_pct', 'charging'];
    rows = samples.map((s) => [
      s.capturedAt,
      ist(s.capturedAt),
      s.deviceModel ?? '',
      s.osName ?? '',
      s.osVersion ?? '',
      s.appVersion ?? '',
      s.appBuild ?? '',
      s.networkType ?? '',
      s.cellularGeneration ?? '',
      s.batteryLevel ?? '',
      s.charging === null ? '' : s.charging ? 'yes' : 'no',
    ]);
  }

  await audit('rider.insights.export', {
    actorId: session.user.id,
    actorRole: (session.user as { role?: string }).role ?? null,
    entityType: 'RiderProfile',
    entityId: id,
    after: { kind, from: from.toISOString(), to: to.toISOString(), rows: rows.length },
  }).catch(() => {});

  return csvResponse({ headers, rows, filename: `rider-${id}-${kind}-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv` });
}
