/**
 * POST /api/delivery/calculate-fee
 *
 * Distance-based delivery fee for the cart. First kilometre is on the house
 * (covered by baseDeliveryFee); after that the perKmDeliveryFee kicks in.
 *
 * estimatedMin = 25 min cooking + 4 min/km delivery — rough but useful at the
 * point of cart preview.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { haversineKm, clampTwo } from '@/lib/utils';

const Body = z.object({
  branchId: z.string(),
  lat: z.number(),
  lng: z.number(),
  orderSubtotal: z.number().nonnegative()
});

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { branchId, lat, lng } = Body.parse(await req.json());

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      latitude: true,
      longitude: true,
      baseDeliveryFee: true,
      perKmDeliveryFee: true
    }
  });
  if (!branch) return new Response('Branch not found', { status: 404 });

  const distanceKm =
    branch.latitude != null && branch.longitude != null
      ? clampTwo(haversineKm({ lat: branch.latitude, lng: branch.longitude }, { lat, lng }))
      : 0;

  const base = Number(branch.baseDeliveryFee);
  const perKm = Number(branch.perKmDeliveryFee);
  const fee = clampTwo(base + perKm * Math.max(0, distanceKm - 1));

  // 25 min cooking + 4 min/km delivery. Rounded so the UI doesn't show 27.34.
  const estimatedMin = Math.round(25 + 4 * distanceKm);

  return Response.json({ fee, distanceKm, estimatedMin });
}
