import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

const HoursDay = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMin:   z.number().int().min(0).max(24 * 60),
  closeMin:  z.number().int().min(0).max(24 * 60),
  closed:    z.boolean().optional()
});

const Body = z.object({
  name:             z.string().min(2).max(80).optional(),
  phone:            z.string().max(40).optional().or(z.literal('').transform(() => undefined)),
  email:            z.string().email().optional().or(z.literal('').transform(() => undefined)),
  line1:            z.string().min(2).max(200).optional(),
  city:             z.string().min(1).max(80).optional(),
  state:            z.string().max(80).optional().or(z.literal('').transform(() => undefined)),
  postalCode:       z.string().max(20).optional(),
  country:          z.string().max(8).optional(),
  latitude:         z.number().min(-90).max(90).nullable().optional(),
  longitude:        z.number().min(-180).max(180).nullable().optional(),
  serviceRadiusKm:  z.number().min(0).max(100).optional(),
  taxRatePct:       z.number().min(0).max(50).optional(),
  baseDeliveryFee:  z.number().min(0).max(5000).optional(),
  perKmDeliveryFee: z.number().min(0).max(500).optional(),
  packagingFee:     z.number().min(0).max(1000).optional(),
  isActive:         z.boolean().optional(),
  hours:            z.array(HoursDay).length(7).optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const branch = await prisma.branch.findFirst({ where: { id, restaurantId: restaurant.id } });
  if (!branch) return new Response('Not found', { status: 404 });

  const data = Body.parse(await req.json());
  const { hours, ...rest } = data;

  await prisma.$transaction(async (tx) => {
    await tx.branch.update({
      where: { id },
      data: {
        ...rest,
        baseDeliveryFee:  rest.baseDeliveryFee  != null ? (rest.baseDeliveryFee  as any) : undefined,
        perKmDeliveryFee: rest.perKmDeliveryFee != null ? (rest.perKmDeliveryFee as any) : undefined,
        packagingFee:     rest.packagingFee     != null ? (rest.packagingFee     as any) : undefined
      }
    });

    if (hours) {
      // Replace all 7 days atomically. A "closed" day is stored as openMin == closeMin == 0.
      await tx.operatingHours.deleteMany({ where: { branchId: id } });
      await tx.operatingHours.createMany({
        data: hours.map((h) => ({
          branchId:  id,
          dayOfWeek: h.dayOfWeek,
          openMin:   h.closed ? 0 : h.openMin,
          closeMin:  h.closed ? 0 : h.closeMin
        }))
      });
    }
  });

  const updated = await prisma.branch.findUnique({ where: { id }, include: { hours: { orderBy: { dayOfWeek: 'asc' } } } });
  return Response.json(updated);
}
