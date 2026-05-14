/**
 * POST /api/checkout/validate-address
 *
 * Check whether a delivery address falls inside a branch's service zone.
 * Called at checkout the moment the customer picks an address — surfaces
 * "we don't deliver to your area" before they hit pay.
 *
 * Unauthenticated by design: a guest filling the cart needs to know if their
 * address works.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { haversineKm, clampTwo } from '@/lib/utils';
import { isPaused } from '@/server/branch-pause';

const Body = z.object({
  branchId: z.string(),
  lat: z.number(),
  lng: z.number()
});

type Reason = 'OUT_OF_RANGE' | 'BRANCH_INACTIVE' | 'BRANCH_PAUSED';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { branchId, lat, lng } = Body.parse(await req.json());

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      serviceRadiusKm: true,
      isActive: true
    }
  });
  if (!branch) return new Response('Branch not found', { status: 404 });

  // Distance is computed for diagnostics regardless of why we might reject.
  const distanceKm =
    branch.latitude != null && branch.longitude != null
      ? clampTwo(haversineKm({ lat: branch.latitude, lng: branch.longitude }, { lat, lng }))
      : 0;
  const serviceRadiusKm = branch.serviceRadiusKm;

  let ok = true;
  let reason: Reason | undefined;

  if (!branch.isActive) {
    ok = false;
    reason = 'BRANCH_INACTIVE';
  } else {
    const pauseState = await isPaused(branchId);
    if (pauseState.paused) {
      ok = false;
      reason = 'BRANCH_PAUSED';
    } else if (distanceKm > serviceRadiusKm) {
      ok = false;
      reason = 'OUT_OF_RANGE';
    }
  }

  return Response.json({ ok, distanceKm, serviceRadiusKm, ...(reason ? { reason } : {}) });
}
