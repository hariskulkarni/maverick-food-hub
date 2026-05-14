/**
 * Restaurant-admin cross-sell suggestions API.
 *
 *   GET  /api/admin/cross-sell                 — list all CrossSell rows for this restaurant
 *   GET  /api/admin/cross-sell?parent=<id>     — filter to a parent item
 *   POST /api/admin/cross-sell                 — create a parent→suggested mapping
 *
 * Validates that both parentItemId and suggestedItemId belong to a branch of
 * the caller's restaurant before persisting. Every mutation is audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const ALLOWED_KINDS = ['frequently_together', 'complete_meal', 'add_drink', 'add_dessert', 'add_side'] as const;

const Body = z.object({
  parentItemId: z.string(),
  suggestedItemId: z.string(),
  sortOrder: z.number().int().optional(),
  surface: z.string().max(40).optional(),
  note: z.string().max(500).nullable().optional(),
  source: z.string().max(40).optional(),
  isActive: z.boolean().optional(),
  kind: z.string().optional().refine(
    (v) => v === undefined || (ALLOWED_KINDS as readonly string[]).includes(v),
    { message: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` }
  )
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const parent = req.nextUrl.searchParams.get('parent');

  const where: any = {
    parentItem: { branch: { restaurantId: r.id } }
  };
  if (parent) where.parentItemId = parent;

  const rows = await prisma.crossSell.findMany({
    where,
    include: {
      parentItem: { select: { id: true, name: true, branchId: true } },
      suggestedItem: { select: { id: true, name: true, price: true, imageUrl: true, branchId: true } }
    },
    orderBy: [{ parentItemId: 'asc' }, { sortOrder: 'asc' }]
  });

  return Response.json({ crossSells: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const data = Body.parse(await req.json());

  if (data.parentItemId === data.suggestedItemId) {
    return new Response('parent and suggested item must differ', { status: 400 });
  }

  // Both items must live under one of this restaurant's branches AND share a branch.
  const items = await prisma.menuItem.findMany({
    where: { id: { in: [data.parentItemId, data.suggestedItemId] }, branch: { restaurantId: r.id } },
    select: { id: true, branchId: true }
  });
  if (items.length !== 2) {
    return new Response('One or both items do not belong to this restaurant', { status: 400 });
  }
  const branchIds = new Set(items.map((i) => i.branchId));
  if (branchIds.size !== 1) {
    return new Response('Parent and suggested item must be in the same branch', { status: 400 });
  }

  try {
    const created = await (prisma as any).crossSell.create({
      data: {
        parentItemId: data.parentItemId,
        suggestedItemId: data.suggestedItemId,
        sortOrder: data.sortOrder ?? 0,
        surface: data.surface ?? 'pdp,cart',
        note: data.note ?? null,
        source: data.source ?? 'manual',
        isActive: data.isActive ?? true,
        kind: data.kind ?? 'frequently_together'
      }
    });

    await audit('crosssell.create', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: r.id,
      entityType: 'CrossSell',
      entityId: created.id,
      after: serialise(created),
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined
    });

    return Response.json(created);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return new Response('This parent → suggested mapping already exists', { status: 409 });
    }
    throw e;
  }
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
