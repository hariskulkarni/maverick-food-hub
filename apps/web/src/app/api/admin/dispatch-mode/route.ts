/**
 * GET   /api/admin/dispatch-mode
 * PATCH /api/admin/dispatch-mode
 *
 * Reads and updates how this restaurant's READY orders find a rider:
 *   riderDispatchMode   FLEET_ONLY | DEDICATED_ONLY | DEDICATED_FIRST
 *   fleetFallbackMinutes  how long to wait on dedicated riders before
 *                         falling back to the platform fleet (DEDICATED_FIRST)
 *
 * Restaurant is resolved from the logged-in ADMIN's session via the
 * standard tenancy helper. 403 for non-admins.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { auth } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(r: { id: string; riderDispatchMode: string; fleetFallbackMinutes: number }) {
  return {
    riderDispatchMode: r.riderDispatchMode,
    fleetFallbackMinutes: r.fleetFallbackMinutes
  };
}

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();
  return Response.json(serialize(restaurant as any));
}

const PatchBody = z.object({
  riderDispatchMode: z.enum(['FLEET_ONLY', 'DEDICATED_ONLY', 'DEDICATED_FIRST']).optional(),
  fleetFallbackMinutes: z.number().int().min(1).max(120).optional()
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();

  let data;
  try {
    data = PatchBody.parse(await req.json());
  } catch {
    return new Response('Invalid request body', { status: 400 });
  }

  const patch: any = {};
  if (data.riderDispatchMode !== undefined) patch.riderDispatchMode = data.riderDispatchMode;
  if (data.fleetFallbackMinutes !== undefined) patch.fleetFallbackMinutes = data.fleetFallbackMinutes;

  if (Object.keys(patch).length === 0) {
    return new Response('Nothing to update', { status: 400 });
  }

  const after = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: patch,
    select: { id: true, riderDispatchMode: true, fleetFallbackMinutes: true }
  });

  return Response.json(serialize(after));
}
