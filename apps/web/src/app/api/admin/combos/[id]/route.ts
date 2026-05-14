/**
 * PATCH  /api/admin/combos/[id] — update a combo (name/desc/price/image/items/etc.)
 * DELETE /api/admin/combos/[id] — soft-delete (sets isAvailable=false) when the
 *   combo is referenced by historical OrderItem rows; hard-delete otherwise.
 *
 * Tenancy: the combo's branch must belong to the caller's restaurant. Mutations
 * are audited with before/after JSON snapshots.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';

export const dynamic = 'force-dynamic';

const ItemPatch = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1)
});

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  price: z.number().min(0).optional(),
  imageUrl: z.string().nullable().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  items: z.array(ItemPatch).min(2).optional(),
  reason: z.string().optional().nullable()
});

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchOwned(id: string, restaurantId: string) {
  return prisma.combo.findFirst({
    where: { id, branch: { restaurantId } },
    include: { items: true, branch: { select: { id: true, name: true } } }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;
  const row = await fetchOwned(id, r.id);
  if (!row) return new Response('Not found', { status: 404 });
  return Response.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Not found', { status: 404 });

  const data = Patch.parse(await req.json());

  // If items are being replaced, validate they all belong to the combo's branch
  // and that we have at least 2 distinct items.
  if (data.items) {
    const itemIds = data.items.map((i) => i.menuItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      return new Response('Duplicate menu item in combo — adjust quantity instead', { status: 400 });
    }
    const found = await prisma.menuItem.findMany({
      where: { id: { in: itemIds }, branchId: before.branchId },
      select: { id: true }
    });
    if (found.length !== itemIds.length) {
      return new Response('One or more menu items are missing or live under a different branch', { status: 400 });
    }
  }

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.slug !== undefined) patch.slug = data.slug.trim() || slugify(data.name ?? before.name);
  if (data.description !== undefined) patch.description = data.description;
  if (data.price !== undefined) patch.price = data.price;
  if (data.imageUrl !== undefined) patch.imageUrl = data.imageUrl;
  if (data.isAvailable !== undefined) patch.isAvailable = data.isAvailable;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const u = await tx.combo.update({ where: { id }, data: patch, include: { items: true } });
      if (data.items) {
        // Replace items wholesale. Simpler than diff-merge and the data set is
        // small (a combo has <10 items in practice).
        await tx.comboItem.deleteMany({ where: { comboId: id } });
        await tx.comboItem.createMany({
          data: data.items.map((i) => ({ comboId: id, menuItemId: i.menuItemId, quantity: i.quantity }))
        });
      }
      return tx.combo.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return new Response('A combo with this slug already exists in this branch', { status: 409 });
    }
    throw e;
  }

  await audit('menu.combo.update' as any, {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Combo',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  // Alert hook — combos use `menu.combo.toggle` style alerts only when the
  // isAvailable flag actually flipped. Edits to name/price/items don't fire.
  if (data.isAvailable !== undefined && before.isAvailable !== data.isAvailable) {
    sendMenuToggleAlert({
      restaurantId: r.id,
      kind: 'combo',
      entityType: 'Combo',
      entityId: id,
      entityName: before.name,
      restaurantName: r.name,
      branchName: before.branch?.name ?? null,
      actorName: session?.user?.name ?? session?.user?.email ?? null,
      actorEmail: session?.user?.email ?? null,
      actorRole: session?.user?.role ?? 'ADMIN',
      oldStatus: before.isAvailable ? 'Enabled' : 'Disabled',
      newStatus: data.isAvailable ? 'Enabled' : 'Disabled',
      reason: data.reason ?? null,
      timestamp: new Date(),
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/combos#combo-${id}`
    }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(combo) failed'));
  }

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Not found', { status: 404 });

  // If any historical OrderItem references this combo, we can't hard-delete —
  // doing so would break order history. Soft-delete instead by toggling
  // isAvailable to false; the combo stays around for audit + invoice rebuilds.
  const refCount = await prisma.orderItem.count({ where: { comboId: id } });
  let after: any = null;
  let mode: 'hard' | 'soft';
  if (refCount === 0) {
    await prisma.combo.delete({ where: { id } });
    mode = 'hard';
  } else {
    after = await prisma.combo.update({
      where: { id },
      data: { isAvailable: false },
      include: { items: true }
    });
    mode = 'soft';
  }

  await audit('menu.combo.delete' as any, {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Combo',
    entityId: id,
    before: serialise(before),
    after: after ? serialise({ ...after, _deleteMode: mode }) : { _deleteMode: mode },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json({ ok: true, mode });
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
