/** Super-admin: YouPI feature-request approvals queue. */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return Response.json({ error: 'Forbidden' }, { status: 403 });
    throw e;
  }
  const rows = await prisma.youpiFeatureRequest.findMany({
    orderBy: [{ requestedAt: 'desc' }],
    take: 500,
    include: { restaurant: { select: { name: true } } },
  });
  return Response.json({
    requests: rows.map((r) => ({
      id: r.id,
      restaurantId: r.restaurantId,
      restaurantName: r.restaurant?.name ?? null,
      status: r.status,
      requestedAt: r.requestedAt,
    })),
  });
}
