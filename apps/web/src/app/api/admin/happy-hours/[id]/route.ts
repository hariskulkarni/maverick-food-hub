/**
 * Single Happy Hour rule admin API.
 *
 *   GET    /api/admin/happy-hours/[id]
 *     Returns the rule + schedules plus a computed `lifecycle` bucket and a
 *     `priceExamplePreview` snippet (effective price for a ₹500 sample item
 *     under the current rule). Used to power the editor's read screen.
 *
 *   PATCH  /api/admin/happy-hours/[id]
 *     Same body shape as POST (everything optional). When `schedules` is
 *     present, replaces rows atomically inside a transaction and writes a
 *     separate `happyhour.schedule.update` audit row.
 *
 *   DELETE /api/admin/happy-hours/[id]
 *     Soft-delete (isActive=false) — keeps history intact so the resolver
 *     replays cleanly and the audit log can be reconstructed.
 *
 * All endpoints are tenancy-guarded by `requireRestaurant()`.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { lifecycleBucket, priceForItem, type HappyHourRuleLite } from '@/server/happy-hours';

export const dynamic = 'force-dynamic';

const Scope = z.enum(['RESTAURANT', 'CATEGORY', 'MENU_ITEM', 'COMBO']);
const DiscountType = z.enum(['PERCENTAGE', 'FIXED_PRICE', 'FIXED_AMOUNT_OFF']);

const ScheduleRow = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440)
}).refine((r) => r.startMin < r.endMin, { message: 'startMin must be < endMin' });

// All-optional version of the create body. We intentionally accept partial
// updates so the admin can flip just `isActive` without resending everything.
const Patch = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  scope: Scope.optional(),
  categoryId: z.string().nullable().optional(),
  menuItemId: z.string().nullable().optional(),
  comboId: z.string().nullable().optional(),
  discountType: DiscountType.optional(),
  percentOff: z.number().min(0).max(100).nullable().optional(),
  fixedPrice: z.number().min(0).nullable().optional(),
  amountOff: z.number().min(0).nullable().optional(),
  minPrice: z.number().min(0).nullable().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  schedules: z.array(ScheduleRow).max(64).optional()
});

async function fetchOwned(id: string, restaurantId: string) {
  return (prisma as any).happyHourRule.findFirst({
    where: { id, restaurantId },
    include: { schedules: true }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const rule = await fetchOwned(id, restaurant.id);
  if (!rule) return Response.json({ error: 'Happy hour rule not found', reason: 'not_found' }, { status: 404 });

  const now = new Date();
  const lite = toLite(rule);
  const lifecycle = lifecycleBucket(lite, now);
  const priced = priceForItem(
    { id: 'preview', categoryId: lite.categoryId ?? null, price: 500 },
    [lite],
    now
  );

  return Response.json({
    ...rule,
    lifecycle,
    priceExamplePreview: {
      sample: 500,
      effectivePrice: priced.effectivePrice,
      savings: priced.savings,
      label: priced.label
    }
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, restaurant.id);
  if (!before) return Response.json({ error: 'Happy hour rule not found', reason: 'not_found' }, { status: 404 });

  const data = Patch.parse(await req.json());

  // If a new scope is supplied, validate tenancy of any newly-referenced entity.
  const nextScope = data.scope ?? before.scope;
  const nextCategoryId = data.categoryId !== undefined ? data.categoryId : before.categoryId;
  const nextMenuItemId = data.menuItemId !== undefined ? data.menuItemId : before.menuItemId;
  const nextComboId = data.comboId !== undefined ? data.comboId : before.comboId;

  if (nextScope === 'CATEGORY' && nextCategoryId && nextCategoryId !== before.categoryId) {
    const owned = await prisma.category.findFirst({
      where: { id: nextCategoryId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return Response.json({ error: 'Category not in this restaurant', reason: 'category_not_owned' }, { status: 403 });
  }
  if (nextScope === 'MENU_ITEM' && nextMenuItemId && nextMenuItemId !== before.menuItemId) {
    const owned = await prisma.menuItem.findFirst({
      where: { id: nextMenuItemId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return Response.json({ error: 'Menu item not in this restaurant', reason: 'item_not_owned' }, { status: 403 });
  }
  if (nextScope === 'COMBO' && nextComboId && nextComboId !== before.comboId) {
    const owned = await prisma.combo.findFirst({
      where: { id: nextComboId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return Response.json({ error: 'Combo not in this restaurant', reason: 'combo_not_owned' }, { status: 403 });
  }

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.description !== undefined) patch.description = data.description;
  if (data.scope !== undefined) patch.scope = data.scope;
  // Re-derive the three scope FKs from the discriminator so an admin who flips
  // RESTAURANT-scope rule into CATEGORY-scope can't leave a stale menuItemId.
  if (data.scope !== undefined || data.categoryId !== undefined) {
    patch.categoryId = nextScope === 'CATEGORY' ? nextCategoryId : null;
  }
  if (data.scope !== undefined || data.menuItemId !== undefined) {
    patch.menuItemId = nextScope === 'MENU_ITEM' ? nextMenuItemId : null;
  }
  if (data.scope !== undefined || data.comboId !== undefined) {
    patch.comboId = nextScope === 'COMBO' ? nextComboId : null;
  }
  if (data.discountType !== undefined) {
    patch.discountType = data.discountType;
    // Zero out the irrelevant reward columns when the type flips so old data
    // doesn't get re-read by the resolver.
    patch.percentOff = data.discountType === 'PERCENTAGE' ? (data.percentOff ?? null) : null;
    patch.fixedPrice = data.discountType === 'FIXED_PRICE' && data.fixedPrice != null ? (data.fixedPrice as any) : null;
    patch.amountOff = data.discountType === 'FIXED_AMOUNT_OFF' && data.amountOff != null ? (data.amountOff as any) : null;
  } else {
    if (data.percentOff !== undefined) patch.percentOff = data.percentOff;
    if (data.fixedPrice !== undefined) patch.fixedPrice = data.fixedPrice != null ? (data.fixedPrice as any) : null;
    if (data.amountOff !== undefined) patch.amountOff = data.amountOff != null ? (data.amountOff as any) : null;
  }
  if (data.minPrice !== undefined) patch.minPrice = data.minPrice != null ? (data.minPrice as any) : null;
  if (data.validFrom !== undefined) patch.validFrom = new Date(data.validFrom);
  if (data.validTo !== undefined) patch.validTo = data.validTo ? new Date(data.validTo) : null;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  patch.updatedById = session?.user?.id ?? null;

  const schedulesChanged = data.schedules !== undefined;

  const updated = await prisma.$transaction(async (tx) => {
    await (tx as any).happyHourRule.update({ where: { id }, data: patch });
    if (schedulesChanged) {
      await (tx as any).happyHourSchedule.deleteMany({ where: { ruleId: id } });
      if (data.schedules && data.schedules.length > 0) {
        await (tx as any).happyHourSchedule.createMany({
          data: data.schedules.map((s) => ({
            ruleId: id,
            dayOfWeek: s.dayOfWeek,
            startMin: s.startMin,
            endMin: s.endMin
          }))
        });
      }
    }
    return (tx as any).happyHourRule.findUnique({
      where: { id },
      include: { schedules: true }
    });
  });

  await audit('happyhour.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: restaurant.id,
    entityType: 'HappyHourRule',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  if (schedulesChanged) {
    await audit('happyhour.schedule.update', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: restaurant.id,
      entityType: 'HappyHourRule',
      entityId: id,
      before: { schedules: (before.schedules ?? []).map((s: any) => ({ dayOfWeek: s.dayOfWeek, startMin: s.startMin, endMin: s.endMin })) },
      after: { schedules: data.schedules ?? [] },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent') ?? null
    });
  }

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, restaurant.id);
  if (!before) return Response.json({ error: 'Happy hour rule not found', reason: 'not_found' }, { status: 404 });

  const updated = await (prisma as any).happyHourRule.update({
    where: { id },
    data: { isActive: false, updatedById: session?.user?.id ?? null }
  });

  await audit('happyhour.deactivate', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: restaurant.id,
    entityType: 'HappyHourRule',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true });
}

// ── helpers ────────────────────────────────────────────────────────────────

function toLite(r: any): HappyHourRuleLite {
  return {
    id: r.id,
    name: r.name,
    scope: r.scope,
    categoryId: r.categoryId ?? null,
    menuItemId: r.menuItemId ?? null,
    comboId: r.comboId ?? null,
    discountType: r.discountType,
    percentOff: r.percentOff ?? null,
    fixedPrice: r.fixedPrice ?? null,
    amountOff: r.amountOff ?? null,
    minPrice: r.minPrice ?? null,
    validFrom: r.validFrom,
    validTo: r.validTo,
    isActive: r.isActive,
    priority: r.priority,
    schedules: (r.schedules ?? []).map((s: any) => ({
      dayOfWeek: s.dayOfWeek,
      startMin: s.startMin,
      endMin: s.endMin
    }))
  };
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
