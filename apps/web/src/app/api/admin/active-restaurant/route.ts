/**
 * Account switcher endpoint. POST { restaurantId } sets the active-restaurant
 * cookie AFTER verifying the caller is a member of that restaurant. The cookie
 * is httpOnly + sameSite=lax so it rides along with normal navigations but
 * isn't readable from client JS. currentRestaurant() re-validates membership on
 * every read, so this endpoint is the only writer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { ACTIVE_RESTAURANT_COOKIE, userCanAccessRestaurant } from '@/server/tenancy';
import { Role } from '@prisma/client';

const Body = z.object({ restaurantId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  if (session.user.role !== Role.ADMIN && session.user.role !== Role.KITCHEN) {
    return new Response('Forbidden', { status: 403 });
  }

  let restaurantId: string;
  try {
    ({ restaurantId } = Body.parse(await req.json()));
  } catch {
    return Response.json({ error: 'restaurantId is required' }, { status: 400 });
  }

  // The caller must be able to access the target (explicit grant OR implied via
  // owning/administering its parent).
  if (!(await userCanAccessRestaurant(session.user.id, restaurantId))) {
    return Response.json({ error: 'You do not have access to that restaurant' }, { status: 404 });
  }
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!restaurant) return Response.json({ error: 'Restaurant not found' }, { status: 404 });

  const res = NextResponse.json({ restaurant });
  res.cookies.set(ACTIVE_RESTAURANT_COOKIE, restaurantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });
  return res;
}
