/**
 * Happy Hour rules admin API — list + create.
 *
 *   GET  /api/admin/happy-hours[?bucket=active|upcoming|expired]
 *     Lists rules scoped to this restaurant, with their schedules. The optional
 *     `bucket` filter uses `lifecycleBucket(rule, now)` so the admin tabs map
 *     1:1 to URL state.
 *
 *   POST /api/admin/happy-hours
 *     Creates a rule (scope + discount + schedules) atomically. Tenancy guard:
 *     when the scope is CATEGORY / MENU_ITEM / COMBO, the referenced entity's
 *     branch must belong to this restaurant.
 *
 * Both endpoints require `requireRestaurant()` and `session.user.role === 'ADMIN'`.
 * Every mutation appends an `happyhour.create` audit row with the after-snapshot.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { lifecycleBucket, type HappyHourRuleLite } from '@/server/happy-hours';

export const dynamic = 'force-dynamic';

const Scope = z.enum(['RESTAURANT', 'CATEGORY', 'MENU_ITEM', 'COMBO']);
const DiscountType = z.enum(['PERCENTAGE', 'FIXED_PRICE', 'FIXED_AMOUNT_OFF']);

const ScheduleRow = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440)
}).refine((r) => r.startMin < r.endMin, { message: 'startMin must be < endMin' });

const Body = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).nullable().optional(),
  scope: Scope,
  categoryId: z.string().nullable().optional(),
  menuItemId: z.string().nullable().optional(),
  comboId: z.string().nullable().optional(),
  discountType: DiscountType,
  percentOff: z.number().min(0).max(100).nullable().optional(),
  fixedPrice: z.number().min(0).nullable().optional(),
  amountOff: z.number().min(0).nullable().optional(),
  minPrice: z.number().min(0).nullable().optional(),
  validFrom: z.string(),
  validTo: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  schedules: z.array(ScheduleRow).max(64).optional()
})
  .refine((d) => {
    // Exactly-one-of guard for non-RESTAURANT scopes.
    if (d.scope === 'RESTAURANT') {
      return !d.categoryId && !d.menuItemId && !d.comboId;
    }
    if (d.scope === 'CATEGORY') {
      return !!d.categoryId && !d.menuItemId && !d.comboId;
    }
    if (d.scope === 'MENU_ITEM') {
      return !d.categoryId && !!d.menuItemId && !d.comboId;
    }
    if (d.scope === 'COMBO') {
      return !d.categoryId && !d.menuItemId && !!d.comboId;
    }
    return false;
  }, { message: 'Exactly one of categoryId/menuItemId/comboId must match the scope' })
  .refine((d) => {
    if (d.discountType === 'PERCENTAGE') return d.percentOff != null && d.percentOff >= 0 && d.percentOff <= 100;
    if (d.discountType === 'FIXED_PRICE') return d.fixedPrice != null && d.fixedPrice > 0;
    if (d.discountType === 'FIXED_AMOUNT_OFF') return d.amountOff != null && d.amountOff > 0;
    return false;
  }, { message: 'Reward fields do not match the chosen discountType' });

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();

  const bucket = req.nextUrl.searchParams.get('bucket') as 'active' | 'upcoming' | 'expired' | null;

  const rows = await (prisma as any).happyHourRule.findMany({
    where: { restaurantId: restaurant.id },
    include: { schedules: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  const now = new Date();
  const enriched = rows.map((r: any) => ({ ...r, lifecycle: lifecycleBucket(toLite(r), now) }));
  const filtered = bucket ? enriched.filter((r: any) => r.lifecycle === bucket) : enriched;

  return Response.json({ rules: filtered });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();

  const data = Body.parse(await req.json());

  // Tenancy guard: ensure referenced entity belongs to this restaurant.
  if (data.scope === 'CATEGORY' && data.categoryId) {
    const owned = await prisma.category.findFirst({
      where: { id: data.categoryId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return new Response('Category not in this restaurant', { status: 403 });
  }
  if (data.scope === 'MENU_ITEM' && data.menuItemId) {
    const owned = await prisma.menuItem.findFirst({
      where: { id: data.menuItemId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return new Response('Menu item not in this restaurant', { status: 403 });
  }
  if (data.scope === 'COMBO' && data.comboId) {
    const owned = await prisma.combo.findFirst({
      where: { id: data.comboId, branch: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!owned) return new Response('Combo not in this restaurant', { status: 403 });
  }

  const schedules = data.schedules ?? [];

  const created = await prisma.$transaction(async (tx) => {
    const rule = await (tx as any).happyHourRule.create({
      data: {
        restaurantId: restaurant.id,
        name: data.name.trim(),
        description: data.description ?? null,
        scope: data.scope,
        categoryId: data.scope === 'CATEGORY' ? data.categoryId : null,
        menuItemId: data.scope === 'MENU_ITEM' ? data.menuItemId : null,
        comboId: data.scope === 'COMBO' ? data.comboId : null,
        discountType: data.discountType,
        percentOff: data.discountType === 'PERCENTAGE' ? data.percentOff : null,
        fixedPrice: data.discountType === 'FIXED_PRICE' && data.fixedPrice != null ? (data.fixedPrice as any) : null,
        amountOff: data.discountType === 'FIXED_AMOUNT_OFF' && data.amountOff != null ? (data.amountOff as any) : null,
        minPrice: data.minPrice != null ? (data.minPrice as any) : null,
        validFrom: new Date(data.validFrom),
        validTo: data.validTo ? new Date(data.validTo) : null,
        priority: data.priority ?? 0,
        isActive: data.isActive ?? true,
        createdById: session?.user?.id ?? null
      }
    });
    if (schedules.length > 0) {
      await (tx as any).happyHourSchedule.createMany({
        data: schedules.map((s) => ({
          ruleId: rule.id,
          dayOfWeek: s.dayOfWeek,
          startMin: s.startMin,
          endMin: s.endMin
        }))
      });
    }
    return (tx as any).happyHourRule.findUnique({
      where: { id: rule.id },
      include: { schedules: true }
    });
  });

  await audit('happyhour.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: restaurant.id,
    entityType: 'HappyHourRule',
    entityId: created?.id ?? null,
    after: serialise(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(created);
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
