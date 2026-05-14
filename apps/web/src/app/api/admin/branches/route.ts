import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

const Body = z.object({
  name: z.string().min(2),
  line1: z.string().min(2),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(3),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  taxRatePct: z.number().min(0).max(50).default(5),
  baseDeliveryFee: z.number().min(0).default(40),
  perKmDeliveryFee: z.number().min(0).default(8),
  serviceRadiusKm: z.number().min(0).default(7)
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const data = Body.parse(await req.json());
  let slug = `${restaurant.slug}-${slugify(data.name)}`;
  let n = 0;
  while (await prisma.branch.findUnique({ where: { slug } })) { n++; slug = `${restaurant.slug}-${slugify(data.name)}-${n}`; }
  const branch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      slug,
      name: `${restaurant.name} — ${data.name}`,
      line1: data.line1,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      phone: data.phone,
      email: data.email,
      taxRatePct: data.taxRatePct,
      baseDeliveryFee: data.baseDeliveryFee as any,
      perKmDeliveryFee: data.perKmDeliveryFee as any,
      serviceRadiusKm: data.serviceRadiusKm,
      hours: { create: Array.from({ length: 7 }).map((_, i) => ({ dayOfWeek: i, openMin: 11 * 60, closeMin: 23 * 60 })) }
    }
  });
  return Response.json(branch);
}
