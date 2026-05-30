/**
 * Category schedule CRUD.
 *
 *  GET    → current scheduleEnabled flag + availability rows + computed status
 *  PUT    → replace the schedule atomically:
 *             { scheduleEnabled: bool, rows: [{ dayOfWeek, startMin, endMin }] }
 *           Audit: 'menu.category.schedule.update' with before/after snapshot.
 *  DELETE → disable scheduling (flip scheduleEnabled=false, wipe rows)
 *           Audit: 'menu.category.schedule.disable'
 *
 * Tenancy: the category's branch must belong to the admin's restaurant.
 *
 * Validation: when scheduleEnabled=true the request MUST include at least
 * one row, each row must have startMin < endMin and dayOfWeek in 0..6.
 * Overlapping rows on the same day are allowed (the resolver dedupes
 * implicitly by short-circuiting on the first match).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { isCategoryAvailableNow } from '@/server/category-availability';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';

const Row = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin:   z.number().int().min(0).max(1440)
}).refine((r) => r.startMin < r.endMin, { message: 'startMin must be < endMin' });

const Body = z.object({
  scheduleEnabled: z.boolean(),
  rows: z.array(Row).max(64),
  reason: z.string().optional().nullable()
}).refine(
  (v) => !v.scheduleEnabled || v.rows.length > 0,
  { message: 'At least one availability row is required when scheduling is enabled' }
);

async function loadCategoryForTenant(id: string, restaurantId: string) {
  return prisma.category.findFirst({
    where: { id, branch: { restaurantId } },
    include: { availabilities: true, branch: { select: { id: true, name: true } } }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const cat = await loadCategoryForTenant(id, restaurant.id);
  if (!cat) return new Response('Not found', { status: 404 });
  const status = isCategoryAvailableNow({
    id: cat.id, name: cat.name,
    isActive: cat.isActive,
    scheduleEnabled: cat.scheduleEnabled,
    availabilities: cat.availabilities
  });
  return Response.json({
    id: cat.id,
    name: cat.name,
    isActive: cat.isActive,
    scheduleEnabled: cat.scheduleEnabled,
    rows: cat.availabilities.map((r) => ({ dayOfWeek: r.dayOfWeek, startMin: r.startMin, endMin: r.endMin })),
    status
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const data = Body.parse(await req.json());

  const before = await loadCategoryForTenant(id, restaurant.id);
  if (!before) return new Response('Not found', { status: 404 });

  // Replace rows atomically: simpler than diffing for a max-of-64 list.
  await prisma.$transaction(async (tx) => {
    await tx.category.update({
      where: { id },
      data: { scheduleEnabled: data.scheduleEnabled }
    });
    await tx.categoryAvailability.deleteMany({ where: { categoryId: id } });
    if (data.scheduleEnabled && data.rows.length > 0) {
      await tx.categoryAvailability.createMany({
        data: data.rows.map((r) => ({
          categoryId: id,
          dayOfWeek: r.dayOfWeek,
          startMin: r.startMin,
          endMin: r.endMin
        }))
      });
    }
  });

  const after = await loadCategoryForTenant(id, restaurant.id);

  await audit('menu.category.schedule.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId: restaurant.id,
    entityType: 'Category',
    entityId: id,
    before: {
      scheduleEnabled: before.scheduleEnabled,
      rows: before.availabilities.map((r) => ({ dayOfWeek: r.dayOfWeek, startMin: r.startMin, endMin: r.endMin }))
    },
    after: {
      scheduleEnabled: after?.scheduleEnabled ?? data.scheduleEnabled,
      rows: data.rows
    },
    ipAddress: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  // Alert hook — fire only if the scheduleEnabled flag itself flipped. Row
  // edits within an already-enabled schedule aren't loud enough to alert on.
  if (before.scheduleEnabled !== data.scheduleEnabled) {
    sendMenuToggleAlert({
      restaurantId: restaurant.id,
      kind: 'category',
      entityType: 'Category',
      entityId: id,
      entityName: before.name,
      restaurantName: restaurant.name,
      branchName: before.branch?.name ?? null,
      actorName: session.user.name ?? session.user.email ?? null,
      actorEmail: session.user.email ?? null,
      actorRole: session.user.role,
      oldStatus: before.scheduleEnabled ? 'Schedule on' : 'Schedule off',
      newStatus: data.scheduleEnabled ? 'Schedule on' : 'Schedule off',
      reason: data.reason ?? null,
      timestamp: new Date(),
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu#category-${id}`
    }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(category schedule) failed'));
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const before = await loadCategoryForTenant(id, restaurant.id);
  if (!before) return new Response('Not found', { status: 404 });
  if (!before.scheduleEnabled) {
    return Response.json({ ok: true, alreadyDisabled: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.category.update({ where: { id }, data: { scheduleEnabled: false } });
    await tx.categoryAvailability.deleteMany({ where: { categoryId: id } });
  });

  await audit('menu.category.schedule.disable', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId: restaurant.id,
    entityType: 'Category',
    entityId: id,
    before: {
      scheduleEnabled: true,
      rows: before.availabilities.map((r) => ({ dayOfWeek: r.dayOfWeek, startMin: r.startMin, endMin: r.endMin }))
    },
    after: { scheduleEnabled: false, rows: [] },
    ipAddress: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  // Schedule deletion is unambiguously a state change (already-disabled is
  // short-circuited above with alreadyDisabled:true).
  sendMenuToggleAlert({
    restaurantId: restaurant.id,
    kind: 'category',
    entityType: 'Category',
    entityId: id,
    entityName: before.name,
    restaurantName: restaurant.name,
    branchName: before.branch?.name ?? null,
    actorName: session.user.name ?? session.user.email ?? null,
    actorEmail: session.user.email ?? null,
    actorRole: session.user.role,
    oldStatus: 'Schedule on',
    newStatus: 'Schedule off',
    reason: null,
    timestamp: new Date(),
    detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu#category-${id}`
  }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(schedule disable) failed'));

  return Response.json({ ok: true });
}
