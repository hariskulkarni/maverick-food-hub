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
import { parseOrJsonError } from '@/server/zod-helpers';
import { matchZone, computeZoneDelivery } from '@/server/delivery/zones';

const Body = z.object({
  branchId: z.string(),
  lat: z.number(),
  lng: z.number(),
  pincode: z.string().optional(),
  // Cart subtotal selects the fee bracket. The fee itself is never client-supplied.
  subtotalPaise: z.number().int().nonnegative().optional()
});

type Reason = 'OUT_OF_RANGE' | 'ZONE_UNAVAILABLE' | 'BRANCH_INACTIVE' | 'BRANCH_PAUSED';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const { branchId, lat, lng, pincode, subtotalPaise = 0 } = parsed;

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
    } else {
      // Zone engine first; null => branch has no zones => legacy radius check.
      const zone = await matchZone(branchId, { lat, lng, pincode });
      if (zone) {
        const d = computeZoneDelivery(zone, subtotalPaise, distanceKm);
        if (!d.available) {
          return Response.json({ ok: false, reason: 'ZONE_UNAVAILABLE', distanceKm, serviceRadiusKm });
        }
        return Response.json({
          ok: true, distanceKm, serviceRadiusKm,
          feePaise: d.feePaise, minOrderPaise: d.minOrderPaise, etaMinutes: d.etaMinutes
        });
      }
      if (distanceKm > serviceRadiusKm) {
        ok = false;
        reason = 'OUT_OF_RANGE';
      }
    }
  }

  return Response.json({ ok, distanceKm, serviceRadiusKm, ...(reason ? { reason } : {}) });
}
