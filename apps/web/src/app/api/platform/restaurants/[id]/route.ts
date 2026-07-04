import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const r = await prisma.restaurant.findUnique({
    where: { id },
    include: {
      owner: true,
      parent: { select: { id: true, name: true, slug: true } },
      children: { orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, status: true } },
      branches: { include: { _count: { select: { menuItems: true, orders: true } } } },
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      integrations: { select: { provider: true, status: true, summary: true, lastTestedAt: true } }
    }
  });
  if (!r) return new Response('Not found', { status: 404 });

  const branchIds = r.branches.map((b) => b.id);
  const thirty = new Date(Date.now() - 30 * 86_400_000);
  const [orders30dAgg, topItems] = await Promise.all([
    prisma.order.aggregate({
      where: { branchId: { in: branchIds }, placedAt: { gte: thirty }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } },
      _sum: { total: true },
      _count: true
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        menuItemId: { not: null },
        order: { branchId: { in: branchIds }, placedAt: { gte: thirty }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } }
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    })
  ]);

  const itemIds = topItems.map((t) => t.menuItemId!).filter(Boolean);
  const items = await prisma.menuItem.findMany({ where: { id: { in: itemIds } } });
  const topItemRows = topItems.map((t) => {
    const m = items.find((i) => i.id === t.menuItemId);
    return { id: t.menuItemId!, name: m?.name ?? 'Unknown', soldQty: t._sum.quantity ?? 0, imageUrl: m?.imageUrl, price: Number(m?.price ?? 0) };
  });

  return Response.json({
    restaurant: r,
    metrics30d: { gmv: Number(orders30dAgg._sum.total ?? 0), orders: orders30dAgg._count },
    topItems: topItemRows
  });
}

/**
 * Super-admin-only identity edits.
 *
 * Allowed fields:
 *   • name           — display name (required ≥ 1 char, max 120)
 *   • tagline        — short hook under the name (max 240)
 *   • cuisine        — one-line cuisine label (max 60)
 *   • slug           — URL slug → /r/<slug>; lowercase a-z 0-9 and dashes only;
 *                      must stay unique across restaurants. Changing it BREAKS
 *                      any printed QR codes / saved links — the UI surfaces a
 *                      confirm before sending.
 *   • commissionPct  — platform's cut, 0-50
 *   • rejectedReason — used by the reject lifecycle action
 *
 * Empty-string is treated as "clear this optional field" for tagline/cuisine.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const PatchBody = z.object({
  name:           z.string().trim().min(1, 'Name required').max(120).optional(),
  tagline:        z.string().trim().max(240).nullable().optional(),
  cuisine:        z.string().trim().max(60).nullable().optional(),
  slug:           z.string().trim().toLowerCase().regex(SLUG_RE, 'Slug must be lowercase letters, digits and dashes (2–64 chars, no leading/trailing dash)').optional(),
  commissionPct:  z.number().min(0).max(50).optional(),
  rejectedReason: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
  }
  const data = parsed.data;

  // Don't issue a no-op update — also lets us audit the diff cleanly.
  const before = await prisma.restaurant.findUnique({
    where: { id },
    select: { id: true, name: true, tagline: true, cuisine: true, slug: true, commissionPct: true },
  });
  if (!before) return new Response('Not found', { status: 404 });

  // Normalize empty strings on optional text fields to null (clears the column).
  const next: Record<string, any> = {};
  if (data.name !== undefined && data.name !== before.name) next.name = data.name;
  if (data.tagline !== undefined) {
    const v = data.tagline === '' ? null : data.tagline;
    if (v !== before.tagline) next.tagline = v;
  }
  if (data.cuisine !== undefined) {
    const v = data.cuisine === '' ? null : data.cuisine;
    if (v !== before.cuisine) next.cuisine = v;
  }
  if (data.slug !== undefined && data.slug !== before.slug) next.slug = data.slug;
  if (data.commissionPct !== undefined && data.commissionPct !== before.commissionPct) next.commissionPct = data.commissionPct;
  if (data.rejectedReason !== undefined) next.rejectedReason = data.rejectedReason;

  if (Object.keys(next).length === 0) {
    return Response.json({ ok: true, unchanged: true });
  }

  // Pre-check slug uniqueness so we can return a clean error message instead
  // of letting Prisma's P2002 bubble up as a 500.
  if (typeof next.slug === 'string') {
    const taken = await prisma.restaurant.findFirst({
      where: { slug: next.slug, NOT: { id } },
      select: { id: true },
    });
    if (taken) {
      return Response.json({ error: `Slug "${next.slug}" is already in use by another restaurant.` }, { status: 409 });
    }
  }

  try {
    await prisma.restaurant.update({ where: { id }, data: next });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return Response.json({ error: 'Slug is already in use.' }, { status: 409 });
    }
    throw e;
  }

  // Identity / commission changed — bust list, dashboard and BOTH storefront
  // slugs (old + new, in case the slug itself changed).
  revalidateRestaurantSurfaces(before.slug, typeof next.slug === 'string' ? next.slug : undefined);

  // Audit identity changes — these are sensitive (rebranding, URL change).
  const identityFields = ['name', 'tagline', 'cuisine', 'slug'] as const;
  const changedIdentity = identityFields.filter((k) => k in next);
  if (changedIdentity.length > 0) {
    await audit('restaurant.settings.update', {
      actorId: session.user.id,
      actorRole: session.user.role,
      restaurantId: id,
      entityType: 'Restaurant',
      entityId: id,
      before: Object.fromEntries(changedIdentity.map((k) => [k, (before as any)[k]])),
      after: Object.fromEntries(changedIdentity.map((k) => [k, next[k]])),
    });
  }

  return Response.json({ ok: true });
}


/**
 * DELETE /api/platform/restaurants/[id] — super-admin PERMANENT delete.
 * Cascade: only Order→Branch and Branch→Restaurant are Restrict; everything
 * else (menu, reservations, tables, offers, QR codes, integrations, members,
 * favorites, happy-hours, coupons) cascades or set-nulls at the DB level. So
 * we delete orders → branches → restaurant inside one transaction.
 *
 * Guard: refuses (409) if the restaurant has ANY orders unless `?force=1`,
 * so order/payment history can't be wiped by accident.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const force = new URL(req.url).searchParams.get('force') === '1';

  const target = await prisma.restaurant.findUnique({ where: { id }, select: { slug: true } });
  const branches = await prisma.branch.findMany({ where: { restaurantId: id }, select: { id: true } });
  const branchIds = branches.map((b) => b.id);

  if (!force && branchIds.length) {
    const orderCount = await prisma.order.count({ where: { branchId: { in: branchIds } } });
    if (orderCount > 0) return Response.json({ error: 'has_orders', orderCount }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (branchIds.length) await tx.order.deleteMany({ where: { branchId: { in: branchIds } } });
      await tx.branch.deleteMany({ where: { restaurantId: id } });
      await tx.restaurant.delete({ where: { id } });
    });
  } catch (e) {
    return Response.json({ error: 'delete_failed', detail: (e as Error).message }, { status: 500 });
  }

  revalidateRestaurantSurfaces(target?.slug);
  return Response.json({ ok: true });
}
