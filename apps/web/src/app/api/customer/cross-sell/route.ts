/**
 * GET /api/customer/cross-sell?parent=<menuItemId>&surface=<pdp|cart>
 *
 * Returns active cross-sell suggestions for a parent item, scoped to the
 * requested surface. Each row inlines the suggested item's display fields
 * (name, price, imageUrl) so the UI can render the strip without a follow-up
 * fetch. Inactive suggestions and items the parent doesn't actually have an
 * active mapping for are filtered out server-side.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const role = session.user.role;
  if (role === 'ADMIN' || role === 'RIDER' || role === 'KITCHEN' || role === 'SUPER_ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const parent = req.nextUrl.searchParams.get('parent');
  const surface = req.nextUrl.searchParams.get('surface') ?? 'pdp';
  const kind = req.nextUrl.searchParams.get('kind');

  if (!parent) return new Response('Missing parent param', { status: 400 });

  const where: any = {
    parentItemId: parent,
    isActive: true,
    surface: { contains: surface }
  };
  if (kind) where.kind = kind;

  const rows = await (prisma as any).crossSell.findMany({
    where,
    include: {
      suggestedItem: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          imageUrl: true,
          isAvailable: true,
          isVeg: true,
          branchId: true,
          categoryId: true
        }
      }
    },
    orderBy: { sortOrder: 'asc' }
  });

  // Only surface suggestions that are themselves available.
  const suggestions = rows
    .filter((r: any) => r.suggestedItem && r.suggestedItem.isAvailable)
    .map((r: any) => ({
      id: r.id,
      sortOrder: r.sortOrder,
      surface: r.surface,
      kind: r.kind ?? 'frequently_together',
      note: r.note,
      source: r.source,
      suggestedItem: r.suggestedItem
    }));

  return Response.json({ suggestions });
}
