import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { slugifyName } from '@/server/brands';

// ─── GET ────────────────────────────────────────────────────────────────────
// Returns every brand on the platform, with cuisine counts and a cheap
// lifetime revenue rollup so the index list can show a stat per row without
// N+1ing reports endpoints.
export async function GET(_req: NextRequest) {
  await requireSuperAdmin();

  const brands = await (prisma as any).brand.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { restaurants: true } },
      restaurants: { select: { id: true } }
    }
  });

  // Lifetime revenue rollup — one grouped query per brand-bucket of branches.
  const branchOwners = await (prisma as any).restaurant.findMany({
    where: { brandId: { not: null } },
    select: { id: true, brandId: true, branches: { select: { id: true } } }
  });
  const branchToBrand = new Map<string, string>();
  for (const r of branchOwners as any[]) {
    if (!r.brandId) continue;
    for (const b of r.branches) branchToBrand.set(b.id, r.brandId);
  }
  const allBranchIds = Array.from(branchToBrand.keys());

  const revenueByBrand = new Map<string, { revenue: number; orders: number }>();
  if (allBranchIds.length > 0) {
    const grouped = await prisma.order.groupBy({
      by: ['branchId'],
      where: {
        branchId: { in: allBranchIds },
        status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN', 'REFUNDED'] }
      },
      _sum: { total: true },
      _count: { _all: true }
    });
    for (const g of grouped) {
      const brandId = branchToBrand.get(g.branchId);
      if (!brandId) continue;
      const cur = revenueByBrand.get(brandId) ?? { revenue: 0, orders: 0 };
      cur.revenue += Number(g._sum.total ?? 0);
      cur.orders  += g._count._all;
      revenueByBrand.set(brandId, cur);
    }
  }

  return Response.json({
    brands: brands.map((b: any) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      tagline: b.tagline,
      description: b.description,
      logoUrl: b.logoUrl,
      coverImageUrl: b.coverImageUrl,
      contactEmail: b.contactEmail,
      contactPhone: b.contactPhone,
      ownerUserId: b.ownerUserId,
      status: b.status,
      createdAt: b.createdAt,
      cuisineCount: b._count.restaurants,
      lifetimeRevenue: revenueByBrand.get(b.id)?.revenue ?? 0,
      lifetimeOrders:  revenueByBrand.get(b.id)?.orders  ?? 0
    }))
  });
}

// ─── POST (create) ──────────────────────────────────────────────────────────
const CreateBody = z.object({
  name:           z.string().min(2),
  slug:           z.string().min(2).optional(),
  tagline:        z.string().optional().nullable(),
  description:    z.string().optional().nullable(),
  logoUrl:        z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  coverImageUrl:  z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  contactEmail:   z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  contactPhone:   z.string().optional().nullable(),
  ownerUserId:    z.string().optional().nullable()
});

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const session = await auth();
  const body = CreateBody.parse(await req.json());

  // Derive slug if missing. On collision, append -2, -3… until unique.
  let base = (body.slug ?? slugifyName(body.name)).trim() || slugifyName(body.name);
  let slug = base;
  let n = 2;
  // Guard so we don't infinite-loop on a fully exhausted namespace
  while (n < 1000) {
    const existing = await (prisma as any).brand.findUnique({ where: { slug } });
    if (!existing) break;
    slug = `${base}-${n++}`;
  }

  const created = await (prisma as any).brand.create({
    data: {
      name:          body.name,
      slug,
      tagline:       body.tagline ?? null,
      description:   body.description ?? null,
      logoUrl:       body.logoUrl ?? null,
      coverImageUrl: body.coverImageUrl ?? null,
      contactEmail:  body.contactEmail ?? null,
      contactPhone:  body.contactPhone ?? null,
      ownerUserId:   body.ownerUserId ?? null
    }
  });

  await audit('brand.create', {
    actorId:   session?.user?.id,
    actorRole: session?.user?.role,
    entityId:  created.id,
    after: {
      id: created.id, slug: created.slug, name: created.name, status: created.status,
      ownerUserId: created.ownerUserId
    },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  });

  return Response.json(created, { status: 201 });
}
