import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

const DaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMin: z.number().int().min(0).max(24 * 60).optional(),
  closeMin: z.number().int().min(0).max(24 * 60).optional(),
  closed: z.boolean().optional()
});
const Body = z.object({ days: z.array(DaySchema).length(7) });

async function ownedItem(id: string, restaurantId: string) {
  return prisma.menuItem.findFirst({
    where: { id, branch: { restaurantId } },
    select: { id: true }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();
  if (!(await ownedItem(id, restaurant.id))) {
    return Response.json({ error: 'Menu item not found.', reason: 'not_found' }, { status: 404 });
  }

  const rows = await prisma.menuItemAvailability.findMany({
    where: { menuItemId: id },
    orderBy: { dayOfWeek: 'asc' }
  });
  // Project to UI shape: closed = (no row or startMin==endMin==0)
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  const days = Array.from({ length: 7 }, (_, d) => {
    const r = byDay.get(d);
    if (!r) return { dayOfWeek: d, openMin: 11 * 60, closeMin: 23 * 60, closed: true };
    const closed = r.startMin === 0 && r.endMin === 0;
    return { dayOfWeek: d, openMin: r.startMin, closeMin: r.endMin, closed };
  });
  // If no rows at all, treat as "always available" (caller sees all closed/default — UI distinguishes via hasSchedule).
  return Response.json({ hasSchedule: rows.length > 0, days });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  if (!(await ownedItem(id, restaurant.id))) {
    return Response.json({ error: 'Menu item not found.', reason: 'not_found' }, { status: 404 });
  }
  const { days } = Body.parse(await req.json());

  // Validate logical times when not closed
  for (const d of days) {
    if (!d.closed) {
      if (d.openMin == null || d.closeMin == null) {
        return Response.json(
          { error: 'Open and close times are required when a day is not marked closed.', reason: 'missing_times' },
          { status: 400 }
        );
      }
      if (d.openMin >= d.closeMin) {
        return Response.json(
          { error: 'Open time must come before close time.', reason: 'time_order' },
          { status: 400 }
        );
      }
    }
  }

  await prisma.$transaction([
    prisma.menuItemAvailability.deleteMany({ where: { menuItemId: id } }),
    prisma.menuItemAvailability.createMany({
      data: days.map((d) => ({
        menuItemId: id,
        dayOfWeek: d.dayOfWeek,
        startMin: d.closed ? 0 : (d.openMin ?? 0),
        endMin: d.closed ? 0 : (d.closeMin ?? 0)
      }))
    })
  ]);

  await audit('menu.schedule.update', {
    actorId: session.user.id,
    restaurantId: restaurant.id,
    entityType: 'MenuItem',
    entityId: id,
    after: { days }
  });

  return Response.json({ ok: true });
}
