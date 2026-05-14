import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const r = await prisma.restaurant.findUnique({
    where: { id },
    include: {
      owner: true,
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

const PatchBody = z.object({
  commissionPct: z.number().min(0).max(50).optional(),
  rejectedReason: z.string().nullable().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());
  await prisma.restaurant.update({ where: { id }, data });
  return Response.json({ ok: true });
}
