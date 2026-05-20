/**
 * Public list of top-level (parent / standalone) ACTIVE restaurants, used by the
 * staff login dropdown so an operator can pick which restaurant they're signing
 * in to. Only names + slugs are exposed (already public on the storefront), and
 * only group ROOTS (parentId null) — children are managed under their parent,
 * so staff log in at the parent. No auth: this just powers a convenience picker;
 * the email+password still does the real authentication, and the selection only
 * sets the active restaurant AFTER a successful login (and only if the user is a
 * member of it).
 */
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE', parentId: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
  return Response.json(restaurants, { headers: { 'Cache-Control': 'no-store' } });
}
