/**
 * PATCH /api/admin/settings/order-flow
 *
 * Updates the order-flow + dine-in toggles on the signed-in admin's restaurant:
 *   autoAcceptOrders, scheduledOrdersEnabled, selfPickupEnabled, dineInEnabled,
 *   and (when dine-in is on) reservationDeposit / reservationDiscountPct /
 *   reservationDurationMin.
 *
 * ADMIN / SUPER_ADMIN only. Validated with zod. Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const Body = z.object({
  autoAcceptOrders: z.boolean().optional(),
  scheduledOrdersEnabled: z.boolean().optional(),
  selfPickupEnabled: z.boolean().optional(),
  dineInEnabled: z.boolean().optional(),
  reservationDeposit: z.number().min(0).max(100000).optional(),
  reservationDiscountPct: z.number().int().min(0).max(100).optional(),
  reservationDurationMin: z.number().int().min(15).max(600).optional()
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();

  const data = Body.parse(await req.json());

  const patch: any = {};
  if (data.autoAcceptOrders !== undefined) patch.autoAcceptOrders = data.autoAcceptOrders;
  if (data.scheduledOrdersEnabled !== undefined) patch.scheduledOrdersEnabled = data.scheduledOrdersEnabled;
  if (data.selfPickupEnabled !== undefined) patch.selfPickupEnabled = data.selfPickupEnabled;
  if (data.dineInEnabled !== undefined) patch.dineInEnabled = data.dineInEnabled;
  if (data.reservationDeposit !== undefined) patch.reservationDeposit = data.reservationDeposit;
  if (data.reservationDiscountPct !== undefined) patch.reservationDiscountPct = data.reservationDiscountPct;
  if (data.reservationDurationMin !== undefined) patch.reservationDurationMin = data.reservationDurationMin;

  const before = await prisma.restaurant.findUnique({
    where: { id: restaurant.id },
    select: {
      autoAcceptOrders: true, scheduledOrdersEnabled: true, selfPickupEnabled: true,
      dineInEnabled: true, reservationDeposit: true, reservationDiscountPct: true, reservationDurationMin: true
    }
  });

  const updated = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: patch,
    select: {
      autoAcceptOrders: true, scheduledOrdersEnabled: true, selfPickupEnabled: true,
      dineInEnabled: true, reservationDeposit: true, reservationDiscountPct: true, reservationDurationMin: true
    }
  });

  await audit('restaurant.settings.update', {
    actorId: session?.user?.id,
    actorRole: role,
    restaurantId: restaurant.id,
    entityType: 'Restaurant',
    entityId: restaurant.id,
    before: JSON.parse(JSON.stringify(before)),
    after: JSON.parse(JSON.stringify(updated)),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json(JSON.parse(JSON.stringify(updated)));
}
