/**
 * Restaurant-admin combos API.
 *
 *   GET  /api/admin/combos              — list combos for this restaurant
 *   POST /api/admin/combos              — create a combo
 *
 * Tenancy: every combo must live under a branch of the caller's restaurant. The
 * POST also enforces that every supplied menuItemId belongs to that same
 * branch — you can't bundle items across branches into a single combo. Every
 * mutation is audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const ItemBody = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1)
});

const Body = z.object({
  branchId: z.string(),
  name: z.string().min(1).max(120),
  slug: z.string().max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  price: z.number().min(0),
  imageUrl: z.string().nullable().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  items: z.array(ItemBody).min(2)
});

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function GET(_req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await requireRestaurant();

  const combos = await prisma.combo.findMany({
    where: { branch: { restaurantId: r.id } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: { include: { menuItem: { select: { id: true, name: true, price: true, isAvailable: true, imageUrl: true } } } }
    }
  });

  return Response.json({ combos });
}

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const r = await requireRestaurant();

  const data = Body.parse(await req.json());

  // Tenancy + cross-branch checks.
  const branch = await prisma.branch.findFirst({
    where: { id: data.branchId, restaurantId: r.id },
    select: { id: true }
  });
  if (!branch) {
    return Response.json({ error: 'Branch does not belong to this restaurant', reason: 'branch_not_owned' }, { status: 400 });
  }

  // All items must live under the same branch as the combo.
  const itemIds = data.items.map((i) => i.menuItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    return Response.json({ error: 'Duplicate menu item in combo — adjust quantity instead', reason: 'duplicate_item' }, { status: 400 });
  }
  const found = await prisma.menuItem.findMany({
    where: { id: { in: itemIds }, branchId: data.branchId },
    select: { id: true }
  });
  if (found.length !== itemIds.length) {
    return Response.json({ error: 'One or more menu items are missing or live under a different branch', reason: 'item_not_in_branch' }, { status: 400 });
  }

  const slug = (data.slug?.trim() || slugify(data.name));

  try {
    const created = await prisma.combo.create({
      data: {
        branchId: data.branchId,
        name: data.name,
        slug,
        description: data.description ?? null,
        price: data.price,
        imageUrl: data.imageUrl ?? null,
        isAvailable: data.isAvailable ?? true,
        sortOrder: data.sortOrder ?? 0,
        items: {
          create: data.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }))
        }
      },
      include: { items: true }
    });

    await audit('menu.combo.create' as any, {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: r.id,
      entityType: 'Combo',
      entityId: created.id,
      after: serialise(created),
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined
    });

    return Response.json(created);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return Response.json({ error: 'A combo with this slug already exists in this branch', reason: 'duplicate_slug' }, { status: 409 });
    }
    throw e;
  }
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
