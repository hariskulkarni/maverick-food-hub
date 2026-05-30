/**
 * POST /api/customer/delivery-eta
 * Body: { branchId: string, lat: number, lng: number }
 *
 * Returns distance, predicted delivery time, within-radius flag, and a
 * delivery-fee preview based on the branch's `baseDeliveryFee` +
 * `perKmDeliveryFee`. Public — no auth required (Phase-1 customer flow lets
 * anonymous customers see ETA before signing in to checkout).
 *
 * The delivery-time formula composes three time blocks:
 *   prepTime   — branch-configured kitchen prep buffer (default 18 min)
 *   pickupTime — fixed ~3 min for rider handoff at the kitchen
 *   travelTime — haversine(branch→customer) ÷ rider cruise speed (25 km/h)
 *
 * We deliberately use haversine rather than a routing API — the precision
 * delta is < 15% at urban scale and a Mapbox / Google Distance Matrix call
 * would add 300–500ms latency to every restaurant page load + a recurring
 * spend we don't want in Phase 1.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { computeEta, DEFAULT_RIDER_SPEED_KPH } from '@/server/eta';
import { haversineKm, clampTwo } from '@/lib/utils';
import { parseOrJsonError } from '@/server/zod-helpers';

const Body = z.object({
  branchId: z.string().min(1),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

// Conservative buffers — admins can tighten these later by exposing them on
// the Branch model. For Phase 1 they live as constants.
const PICKUP_BUFFER_MIN = 3;
const DEFAULT_PREP_MIN = 18;

export async function POST(req: NextRequest) {
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: {
      id: true,
      name: true,
      city: true,
      isActive: true,
      latitude: true,
      longitude: true,
      serviceRadiusKm: true,
      baseDeliveryFee: true,
      perKmDeliveryFee: true,
    },
  });
  if (!branch) return Response.json({ error: 'Branch not found' }, { status: 404 });
  if (branch.latitude == null || branch.longitude == null) {
    return Response.json({
      error: 'branch_no_geo',
      message: 'This branch hasn\'t set its location yet.',
    }, { status: 200 });
  }

  const distanceKm = clampTwo(
    haversineKm(
      { lat: branch.latitude, lng: branch.longitude },
      { lat: data.lat, lng: data.lng },
    ),
  );
  const radius = branch.serviceRadiusKm ?? 0;
  const withinRadius = radius <= 0 || distanceKm <= radius;

  // Travel time (rider speed) + branch-configured kitchen prep + pickup buffer.
  const travelMin = computeEta(
    { lat: branch.latitude, lng: branch.longitude },
    { lat: data.lat, lng: data.lng },
  ) ?? 0;
  const prepMin = DEFAULT_PREP_MIN; // hook this to branch.avgPrepTimeMin later
  const totalEtaMin = Math.max(15, Math.round(travelMin + prepMin + PICKUP_BUFFER_MIN));

  // Delivery fee preview using the branch's base + per-km configuration.
  // Mirrors the pricing engine's distance billing: first km included in base.
  const billableKm = Math.max(0, distanceKm - 1);
  const deliveryFee = clampTwo(
    Number(branch.baseDeliveryFee) + Number(branch.perKmDeliveryFee) * billableKm,
  );

  return Response.json({
    branchId: branch.id,
    branchName: branch.name,
    branchCity: branch.city,
    distanceKm,
    withinRadius,
    serviceRadiusKm: radius,
    etaMin: totalEtaMin,
    etaRange: { min: totalEtaMin - 5, max: totalEtaMin + 10 },
    deliveryFee,
    riderSpeedKph: DEFAULT_RIDER_SPEED_KPH,
    breakdown: {
      prepMin,
      pickupMin: PICKUP_BUFFER_MIN,
      travelMin: Math.round(travelMin),
    },
  });
}
