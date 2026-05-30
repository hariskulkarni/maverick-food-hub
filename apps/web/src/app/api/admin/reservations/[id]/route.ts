/**
 * PATCH /api/admin/reservations/[id]
 *   body: { action: 'confirm' | 'seat' | 'complete' | 'noshow' | 'cancel', reason?, ref? }
 *
 * Delegates lifecycle transitions to src/server/reservations.ts. The
 * reservation must belong to the signed-in admin's primary branch. ADMIN only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import {
  confirmReservation,
  markReservationSeated,
  markReservationCompleted,
  markReservationNoShow,
  cancelReservation
} from '@/server/reservations';
import { primaryBranchForCurrentRestaurant, serialize } from '../_helpers';

export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['confirm', 'seat', 'complete', 'noshow', 'cancel']),
  reason: z.string().max(500).optional(),
  ref: z.string().max(120).optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const existing = await prisma.reservation.findFirst({ where: { id, branchId: branch.id } });
  if (!existing) return Response.json({ error: 'Reservation not found', reason: 'not_found' }, { status: 404 });

  const { action, reason, ref } = Body.parse(await req.json());

  try {
    let updated;
    switch (action) {
      case 'confirm':
        updated = await confirmReservation(id, ref ?? 'admin-confirmed');
        break;
      case 'seat':
        updated = await markReservationSeated(id);
        break;
      case 'complete':
        updated = await markReservationCompleted(id);
        break;
      case 'noshow':
        updated = await markReservationNoShow(id);
        break;
      case 'cancel':
        updated = await cancelReservation(id, session.user.id, reason);
        break;
    }
    return Response.json(serialize(updated));
  } catch (e: any) {
    return Response.json({ error: e?.message ?? 'Action failed', reason: 'action_failed' }, { status: 400 });
  }
}
