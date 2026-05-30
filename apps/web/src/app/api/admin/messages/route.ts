/**
 * GET  /api/admin/messages — every ADMIN-party conversation for this admin's
 *      restaurant, plus a roster of riders the admin can start a chat with
 *      (riders dedicated to the restaurant + riders who've delivered for it).
 * POST /api/admin/messages — { riderId, body } → find-or-create the
 *      ADMIN conversation scoped to this restaurant and append an ADMIN message.
 *
 * The restaurant is resolved from the ADMIN's session via `requireRestaurant`,
 * matching every other `/api/admin/*` route.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import {
  findOrCreateConversation,
  postMessage,
  serializeConversation,
} from '@/server/rider-messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Riders dedicated to, or who have delivered for, the given restaurant. */
async function rosterFor(restaurantId: string) {
  const [dedicated, deliveredFor] = await Promise.all([
    prisma.riderProfile.findMany({
      where: { dedicatedRestaurantId: restaurantId },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    }),
    prisma.riderProfile.findMany({
      where: { assignments: { some: { order: { branch: { restaurantId } } } } },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    }),
  ]);

  const byId = new Map<string, (typeof dedicated)[number] & { dedicated?: boolean }>();
  for (const r of dedicated) byId.set(r.id, { ...r, dedicated: true });
  for (const r of deliveredFor) if (!byId.has(r.id)) byId.set(r.id, { ...r, dedicated: false });

  return [...byId.values()]
    .map((r) => ({
      id: r.id,
      name: r.user?.name ?? null,
      phone: r.user?.phone ?? null,
      avatarUrl: r.user?.avatarUrl ?? null,
      isOnline: r.isOnline,
      dedicated: !!r.dedicated,
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  const [conversations, riders] = await Promise.all([
    prisma.riderConversation.findMany({
      where: { party: 'ADMIN', restaurantId: restaurant.id },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
        _count: { select: { messages: true } },
      },
    }),
    rosterFor(restaurant.id),
  ]);

  return Response.json({
    restaurant: { id: restaurant.id, name: restaurant.name },
    conversations: conversations.map((c) => serializeConversation(c, 'staff')),
    riders,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();

  let body: { riderId?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const riderId = typeof body.riderId === 'string' ? body.riderId : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!riderId) return Response.json({ error: 'riderId is required' }, { status: 400 });
  if (!text) return Response.json({ error: 'Message cannot be empty' }, { status: 400 });

  const rider = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    select: { id: true },
  });
  if (!rider) return Response.json({ error: 'Rider not found' }, { status: 404 });

  const conversation = await findOrCreateConversation({
    riderId,
    party: 'ADMIN',
    restaurantId: restaurant.id,
  });
  // Staff messages are signed with the restaurant name (falling back to the
  // admin's own name) so the rider sees a friendly sender.
  await postMessage(
    conversation.id,
    'ADMIN',
    restaurant.name ?? session.user.name ?? null,
    text
  );

  const full = await prisma.riderConversation.findUnique({
    where: { id: conversation.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
      _count: { select: { messages: true } },
    },
  });
  if (!full) return Response.json({ error: 'Conversation not found', reason: 'not_found' }, { status: 404 });

  return Response.json({ conversation: serializeConversation(full, 'staff') }, { status: 201 });
}
