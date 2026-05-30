/**
 * Customer favorite restaurants.
 *   GET    — list the signed-in user's favorited restaurants
 *   POST   — { restaurantId } add
 *   DELETE — ?restaurantId=… remove
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const favorites = await prisma.favoriteRestaurant.findMany({
    where: { userId: session.user.id },
    include: { restaurant: { select: { id: true, name: true, slug: true, logoUrl: true, cuisine: true } } },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json({ favorites });
}

const PostBody = z.object({ restaurantId: z.string() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = parseOrJsonError(PostBody, await req.json());
  if (parsed instanceof Response) return parsed;
  const { restaurantId } = parsed;
  const fav = await prisma.favoriteRestaurant.upsert({
    where: { userId_restaurantId: { userId: session.user.id, restaurantId } },
    create: { userId: session.user.id, restaurantId },
    update: {}
  });
  return Response.json({ favorite: fav });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const restaurantId = new URL(req.url).searchParams.get('restaurantId');
  if (!restaurantId) return new Response('restaurantId required', { status: 400 });
  await prisma.favoriteRestaurant.deleteMany({
    where: { userId: session.user.id, restaurantId }
  });
  return Response.json({ ok: true });
}
