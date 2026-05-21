import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '@/server/db';
import { Role, RestaurantStatus } from '@prisma/client';
import { rateLimit } from '@/server/http/rate-limit';

const HoursDay = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMin:   z.number().int().min(0).max(24 * 60),
  closeMin:  z.number().int().min(0).max(24 * 60),
  closed:    z.boolean().optional()
});

const MenuItem = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal('').transform(() => undefined)),
  price: z.number().nonnegative(),
  isVeg: z.boolean().optional(),
  imageUrl: z.string().optional().or(z.literal('').transform(() => undefined))
});

const Body = z.object({
  // Owner
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),

  // Restaurant
  restaurantName: z.string().min(2),
  cuisine: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  contactPhone: z.string().optional(),
  logoUrl: z.string().optional().or(z.literal('').transform(() => undefined)),
  coverImageUrl: z.string().optional().or(z.literal('').transform(() => undefined)),

  // Branch
  branchName: z.string().min(2),
  line1: z.string().min(2),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(3),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),

  // Hours (optional — defaults to 11–23 every day)
  hours: z.array(HoursDay).length(7).optional(),

  // First-menu items (optional)
  menuItems: z.array(MenuItem).optional()
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'signup-restaurant', limit: 5, windowMs: 600_000 });
  if (!rl.ok) return rl.response;

  const data = Body.parse(await req.json());

  // Make sure email isn't already a non-admin
  const existing = await prisma.user.findUnique({ where: { email: data.ownerEmail } });
  if (existing && existing.role !== Role.ADMIN) {
    return new Response('That email is already in use by another role', { status: 409 });
  }

  // Unique restaurant slug
  let slug = slugify(data.restaurantName);
  let n = 0;
  while (await prisma.restaurant.findUnique({ where: { slug } })) { n++; slug = `${slugify(data.restaurantName)}-${n}`; }

  const branchSlug = `${slug}-${slugify(data.branchName)}`;

  const passwordHash = await argon2.hash(data.ownerPassword);

  const owner = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name: data.ownerName, passwordHash, role: Role.ADMIN } })
    : await prisma.user.create({ data: { email: data.ownerEmail, name: data.ownerName, passwordHash, role: Role.ADMIN } });

  // Build hours: convert closed days to openMin=closeMin=0, default to 11–23 if none supplied.
  const hoursCreate = (data.hours ?? Array.from({ length: 7 }).map((_, i) => ({ dayOfWeek: i, openMin: 11 * 60, closeMin: 23 * 60, closed: false }))).map((h) => ({
    dayOfWeek: h.dayOfWeek,
    openMin:   h.closed ? 0 : h.openMin,
    closeMin:  h.closed ? 0 : h.closeMin
  }));

  const restaurant = await prisma.restaurant.create({
    data: {
      slug,
      name: data.restaurantName,
      cuisine: data.cuisine,
      tagline: data.tagline,
      description: data.description,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      logoUrl: data.logoUrl,
      coverImageUrl: data.coverImageUrl,
      ownerUserId: owner.id,
      status: RestaurantStatus.PENDING,
      members: { create: { userId: owner.id, role: Role.ADMIN } },
      branches: {
        create: {
          slug: branchSlug,
          name: `${data.restaurantName} — ${data.branchName}`,
          line1: data.line1,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          country: 'IN',
          latitude: data.latitude ?? undefined,
          longitude: data.longitude ?? undefined,
          hours: { create: hoursCreate }
        }
      }
    },
    include: { branches: true }
  });

  // Seed first menu items into a default "Specials" category if any were submitted
  if (data.menuItems && data.menuItems.length > 0) {
    const branch = restaurant.branches[0];
    const category = await prisma.category.create({
      data: { branchId: branch.id, slug: `${branch.slug}-specials`, name: 'Specials', sortOrder: 0 }
    });
    let i = 0;
    for (const m of data.menuItems) {
      const itemSlug = `${category.slug}-${slugify(m.name)}-${++i}`;
      await prisma.menuItem.create({
        data: {
          branchId: branch.id,
          categoryId: category.id,
          name: m.name,
          slug: itemSlug,
          description: m.description,
          price: m.price as any,
          isVeg: m.isVeg ?? true,
          imageUrl: m.imageUrl,
          isAvailable: true,
          sortOrder: i
        }
      });
    }
  }

  return Response.json({ restaurantId: restaurant.id, status: restaurant.status, slug: restaurant.slug });
}
