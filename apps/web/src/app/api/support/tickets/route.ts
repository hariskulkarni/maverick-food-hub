/**
 * POST /api/support/tickets
 * Authenticated users (customer / rider / etc) open a support ticket.
 * The ticket gets tied to the user via the appropriate column based on role.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role, TicketType } from '@prisma/client';
import { rateLimit } from '@/server/http/rate-limit';

const Body = z.object({
  orderId: z.string().optional(),
  type: z.nativeEnum(TicketType),
  message: z.string().min(3).max(2000)
});

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'support-tickets', limit: 10, windowMs: 600_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const body = Body.parse(await req.json());

  // Resolve role-specific fields. RIDERs map to riderId via RiderProfile.
  let restaurantId: string | undefined;
  let riderId: string | undefined;
  let customerId: string | undefined;

  if (session.user.role === Role.RIDER) {
    const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    riderId = profile?.id;
  } else if (session.user.role === Role.ADMIN || session.user.role === Role.KITCHEN) {
    const membership = await prisma.restaurantUser.findFirst({ where: { userId: session.user.id }, select: { restaurantId: true } });
    restaurantId = membership?.restaurantId;
  } else {
    customerId = session.user.id;
  }

  // If they reference an order, sanity-check it exists; not a hard requirement.
  let derivedRestaurantId = restaurantId;
  if (body.orderId && !derivedRestaurantId) {
    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      select: { branch: { select: { restaurantId: true } } }
    });
    if (order) derivedRestaurantId = order.branch.restaurantId;
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      orderId: body.orderId,
      type: body.type,
      message: body.message,
      customerId,
      riderId,
      restaurantId: derivedRestaurantId
    }
  });
  return Response.json({ ticket });
}
