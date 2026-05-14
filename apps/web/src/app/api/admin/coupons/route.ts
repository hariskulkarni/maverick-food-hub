/**
 * Restaurant-admin coupons API.
 *
 *   GET  /api/admin/coupons         – list coupons scoped to the caller's restaurant
 *                                     (i.e. all coupons whose branch belongs to the
 *                                     restaurant, plus any with branchId=null but
 *                                     "owned" by this restaurant via convention).
 *   POST /api/admin/coupons         – create a coupon; auto-uppercases the code,
 *                                     attaches it to the restaurant's first branch
 *                                     when no branchId is provided.
 *
 * Every mutation is recorded via audit() so disputes can be reconstructed.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

const Body = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(500).optional().nullable(),
  flatOff: z.number().nullable().optional(),
  percentOff: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  perUserLimit: z.number().int().optional(),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  isActive: z.boolean().optional()
});

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const r = await requireRestaurant();
  const branches = await prisma.branch.findMany({ where: { restaurantId: r.id }, select: { id: true } });
  const branchIds = branches.map((b) => b.id);
  const coupons = await prisma.coupon.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json({ coupons });
}

export async function POST(req: NextRequest) {
  const r = await requireRestaurant();
  const session = await auth();
  const raw = await req.json();
  const data = Body.parse(raw);

  // Resolve branchId: prefer explicit, else first active branch of this restaurant.
  let branchId = data.branchId ?? null;
  if (branchId) {
    const owned = await prisma.branch.findFirst({ where: { id: branchId, restaurantId: r.id }, select: { id: true } });
    if (!owned) return new Response('Branch not in this restaurant', { status: 403 });
  } else {
    const b = await prisma.branch.findFirst({ where: { restaurantId: r.id, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    branchId = b?.id ?? null;
  }

  // Normalise: at least one of flatOff/percentOff must be set; the other is null.
  const flatOff = data.flatOff && data.flatOff > 0 ? data.flatOff : null;
  const percentOff = data.percentOff && data.percentOff > 0 ? data.percentOff : null;
  if (!flatOff && !percentOff) return new Response('Provide flatOff or percentOff', { status: 400 });

  const code = data.code.trim().toUpperCase();
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) return new Response('Code already exists', { status: 409 });

  const created = await prisma.coupon.create({
    data: {
      code,
      description: data.description ?? null,
      branchId,
      flatOff: flatOff as any,
      percentOff: percentOff,
      minOrderAmount: data.minOrderAmount != null ? (data.minOrderAmount as any) : null,
      maxDiscount: data.maxDiscount != null ? (data.maxDiscount as any) : null,
      usageLimit: data.usageLimit ?? 1000,
      perUserLimit: data.perUserLimit ?? 1,
      validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
      validTo: data.validTo ? new Date(data.validTo) : null,
      isActive: data.isActive ?? true
    }
  });

  await audit('coupon.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Coupon',
    entityId: created.id,
    after: serialise(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json(created);
}

function serialise<T extends Record<string, any>>(obj: T) {
  return JSON.parse(JSON.stringify(obj));
}
