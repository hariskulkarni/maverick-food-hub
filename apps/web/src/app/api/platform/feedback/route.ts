/**
 * GET /api/platform/feedback
 *
 * Super-admin variant — no restaurant scope. Supports filtering by
 * `restaurantId`, `riderId`, and `orderId` query params (the latter is used
 * by the platform orders drawer to pull the feedback for a single order).
 *
 * Every row is projected through `visibleForRole(_, 'SUPER_ADMIN')`, which is
 * "full visibility" — comments, both ratings, image, all tags. The redaction
 * function is still invoked (rather than spreading raw rows) so the response
 * shape is consistent with the admin/rider endpoints and the consumer never
 * has to branch on role.
 */
import { NextRequest } from 'next/server';
import { requireCapability } from '@/server/tenancy';
import { visibleForRole, summariseRatings } from '@/server/feedback';
import { prisma } from '@/server/db';

export async function GET(req: NextRequest) {
  await requireCapability('ops:read');
  const sp = req.nextUrl.searchParams;
  const restaurantId = sp.get('restaurantId') || undefined;
  const riderId = sp.get('riderId') || undefined;
  const orderId = sp.get('orderId') || undefined;
  const from = sp.get('from') ? new Date(sp.get('from') as string) : undefined;
  const to = sp.get('to') ? new Date(sp.get('to') as string) : undefined;

  const where: any = {};
  if (orderId) where.orderId = orderId;
  if (restaurantId) where.order = { ...(where.order ?? {}), branch: { restaurantId } };
  if (riderId) where.order = { ...(where.order ?? {}), assignment: { riderId } };
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };

  const rows = await (prisma as any).orderFeedback.findMany({
    where,
    include: {
      order: {
        select: {
          code: true,
          total: true,
          branchId: true,
          branch: { select: { restaurantId: true, restaurant: { select: { name: true } } } },
          assignment: { select: { riderId: true, rider: { select: { user: { select: { name: true, phone: true } } } } } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  const projected = rows.map((r: any) => ({
    ...visibleForRole(r, 'SUPER_ADMIN'),
    order: {
      id: r.orderId,
      code: r.order?.code ?? null,
      total: r.order?.total ?? null,
      restaurant: r.order?.branch?.restaurant?.name ?? null,
      restaurantId: r.order?.branch?.restaurantId ?? null,
      rider: r.order?.assignment?.rider?.user?.name ?? null,
      riderPhone: r.order?.assignment?.rider?.user?.phone ?? null,
      riderId: r.order?.assignment?.riderId ?? null
    }
  }));

  return Response.json({ rows: projected, summary: summariseRatings(rows) });
}
