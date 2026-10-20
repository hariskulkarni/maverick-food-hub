/**
 * GET /api/delivery/eta/[orderId]
 *
 * Best-effort ETA for an in-flight order:
 *   - If a rider is assigned and has a current GPS fix, compute remaining
 *     distance to the customer address and convert at 4 min/km plus a small
 *     handover buffer.
 *   - Otherwise fall back to assignment.assignedAt + the same 25 + 4 * dKm
 *     formula used at checkout (branch → customer distance).
 *   - If neither rider nor address coords exist, return a null ETA so the
 *     client can show "—".
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { clampTwo } from '@/lib/utils';
import { routeDistance } from '@/server/geo/routing';

export const dynamic = 'force-dynamic';

const HANDOVER_MIN = 2;            // doorstep buffer
const PER_KM_MIN   = 4;            // average urban delivery speed
const COOK_MIN     = 25;           // used as baseline before pickup
const TERMINAL_STATUSES = new Set([
  'DELIVERED',
  'CANCELLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_ADMIN',
  'REFUNDED',
  'DELIVERY_FAILED'
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      assignment: { include: { rider: true } },
      address: true,
      branch: true
    }
  });
  if (!order) return new Response('Not found', { status: 404 });

  // H3: require a session. Previously a null session skipped the CUSTOMER
  // ownership check, so an unauthenticated caller holding an order id (resolvable
  // from the public order code) got the live rider GPS-derived ETA.
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  if (session.user.role === 'CUSTOMER' && order.customerId !== session.user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  if (TERMINAL_STATUSES.has(order.status)) {
    return Response.json({
      orderId: order.id,
      status: order.status,
      etaAt: order.deliveredAt ?? null,
      etaMin: null,
      source: 'TERMINAL'
    });
  }

  const dest =
    order.address?.latitude != null && order.address?.longitude != null
      ? { lat: order.address.latitude, lng: order.address.longitude }
      : null;

  const rider = order.assignment?.rider;
  const riderPos =
    rider?.currentLat != null && rider?.currentLng != null
      ? { lat: rider.currentLat, lng: rider.currentLng }
      : null;

  // Path A — rider GPS available: live-distance ETA.
  if (riderPos && dest) {
    const leg = await routeDistance(riderPos, dest);
    const remainingKm = clampTwo(leg.distanceKm);
    const etaMin = Math.max(1, Math.round(remainingKm * PER_KM_MIN + HANDOVER_MIN));
    return Response.json({
      orderId: order.id,
      status: order.status,
      etaAt: new Date(Date.now() + etaMin * 60_000).toISOString(),
      etaMin,
      remainingKm,
      ...(leg.polyline ? { polyline: leg.polyline } : {}),
      source: 'RIDER_GPS'
    });
  }

  // Path B — fall back to assignment-time + cook + branch-to-customer drive.
  const branch =
    order.branch?.latitude != null && order.branch?.longitude != null
      ? { lat: order.branch.latitude, lng: order.branch.longitude }
      : null;
  const driveLeg = branch && dest ? await routeDistance(branch, dest) : null;
  const driveKm = driveLeg ? clampTwo(driveLeg.distanceKm) : 0;
  const baseMin = COOK_MIN + PER_KM_MIN * driveKm;

  if (order.assignment?.assignedAt) {
    const etaAt = new Date(order.assignment.assignedAt.getTime() + baseMin * 60_000);
    const etaMin = Math.max(1, Math.round((etaAt.getTime() - Date.now()) / 60_000));
    return Response.json({
      orderId: order.id,
      status: order.status,
      etaAt: etaAt.toISOString(),
      etaMin,
      ...(driveLeg?.polyline ? { polyline: driveLeg.polyline } : {}),
      source: 'ASSIGNMENT_FALLBACK'
    });
  }

  // Path C — pre-assignment: anchor on order.placedAt.
  if (order.placedAt) {
    const etaAt = new Date(order.placedAt.getTime() + baseMin * 60_000);
    const etaMin = Math.max(1, Math.round((etaAt.getTime() - Date.now()) / 60_000));
    return Response.json({
      orderId: order.id,
      status: order.status,
      etaAt: etaAt.toISOString(),
      etaMin,
      ...(driveLeg?.polyline ? { polyline: driveLeg.polyline } : {}),
      source: 'PLACED_FALLBACK'
    });
  }

  return Response.json({
    orderId: order.id,
    status: order.status,
    etaAt: null,
    etaMin: null,
    source: 'UNKNOWN'
  });
}
