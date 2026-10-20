/**
 * GET /api/storefront/[slug]/reviews?page=1&pageSize=10
 * Public, unauthenticated. PUBLISHED in-app reviews (redacted — see
 * server/reviews/public.ts) merged with synced Google reviews, newest first.
 */
import { prisma } from '@/server/db';
import { loadPublicReviews } from '@/server/reviews/public';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true } });
  if (!restaurant) return new Response('Not found', { status: 404 });
  const sp = new URL(req.url).searchParams;
  const data = await loadPublicReviews(restaurant.id, {
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 10,
  });
  return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } });
}
