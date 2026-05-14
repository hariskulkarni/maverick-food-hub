import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

const Body = z.object({
  name:          z.string().min(2).max(80),
  tagline:       z.string().max(160).optional().or(z.literal('').transform(() => undefined)),
  description:   z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  cuisine:       z.string().max(80).optional().or(z.literal('').transform(() => undefined)),
  contactEmail:  z.string().email().optional().or(z.literal('').transform(() => undefined)),
  contactPhone:  z.string().max(40).optional().or(z.literal('').transform(() => undefined)),
  logoUrl:       z.string().url().optional().or(z.literal('').transform(() => undefined)),
  coverImageUrl: z.string().url().optional().or(z.literal('').transform(() => undefined))
});

export async function PATCH(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const data = Body.parse(await req.json());
  const updated = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      name: data.name,
      tagline: data.tagline ?? null,
      description: data.description ?? null,
      cuisine: data.cuisine ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      logoUrl: data.logoUrl ?? null,
      coverImageUrl: data.coverImageUrl ?? null
    }
  });
  return Response.json(updated);
}
