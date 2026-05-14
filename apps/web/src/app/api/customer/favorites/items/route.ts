/**
 * Customer favorite menu items.
 *   GET    — list the signed-in user's favorited items
 *   POST   — { menuItemId } add
 *   DELETE — ?menuItemId=… remove
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const favorites = await prisma.favoriteItem.findMany({
    where: { userId: session.user.id },
    include: {
      menuItem: {
        select: {
          id: true, name: true, slug: true, price: true, imageUrl: true, isVeg: true, isAvailable: true,
          branch: { select: { id: true, slug: true, name: true, restaurant: { select: { slug: true, name: true } } } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json({ favorites });
}

const PostBody = z.object({ menuItemId: z.string() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const { menuItemId } = PostBody.parse(await req.json());
  const fav = await prisma.favoriteItem.upsert({
    where: { userId_menuItemId: { userId: session.user.id, menuItemId } },
    create: { userId: session.user.id, menuItemId },
    update: {}
  });
  return Response.json({ favorite: fav });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const menuItemId = new URL(req.url).searchParams.get('menuItemId');
  if (!menuItemId) return new Response('menuItemId required', { status: 400 });
  await prisma.favoriteItem.deleteMany({
    where: { userId: session.user.id, menuItemId }
  });
  return Response.json({ ok: true });
}
