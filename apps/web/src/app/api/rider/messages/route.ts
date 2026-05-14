/**
 * GET  /api/rider/messages — this rider's conversations (one with platform ops,
 *      one per restaurant they're linked to), newest activity first, each with
 *      its last message + the rider's unread count.
 * POST /api/rider/messages — { party, body } → find-or-create the conversation
 *      for that party and append the rider's message.
 *
 * `party = ADMIN` requires the rider to be DEDICATED to a restaurant — the
 * conversation is scoped to `dedicatedRestaurantId`. `party = SUPER_ADMIN` is
 * always available.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import {
  findOrCreateConversation,
  postMessage,
  serializeConversation,
} from '@/server/rider-messaging';
import type { RiderConversationParty } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const conversations = await prisma.riderConversation.findMany({
    where: { riderId: profile.id },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      _count: { select: { messages: true } },
    },
  });

  // Attach restaurant names so the rider sees who they're talking to.
  const restaurantIds = [
    ...new Set(conversations.map((c) => c.restaurantId).filter((x): x is string => !!x)),
  ];
  const restaurants = restaurantIds.length
    ? await prisma.restaurant.findMany({
        where: { id: { in: restaurantIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(restaurants.map((r) => [r.id, r.name]));

  return Response.json({
    conversations: conversations.map((c) => ({
      ...serializeConversation(c, 'rider'),
      restaurantName: c.restaurantId ? nameById.get(c.restaurantId) ?? null : null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, dedicatedRestaurantId: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  let body: { party?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const party =
    body.party === 'ADMIN' || body.party === 'SUPER_ADMIN'
      ? (body.party as RiderConversationParty)
      : null;
  const text = typeof body.body === 'string' ? body.body.trim() : '';

  if (!party) {
    return Response.json({ error: 'party must be ADMIN or SUPER_ADMIN' }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: 'Message cannot be empty' }, { status: 400 });
  }

  let restaurantId: string | null = null;
  if (party === 'ADMIN') {
    if (!profile.dedicatedRestaurantId) {
      return Response.json(
        { error: "You aren't dedicated to a restaurant, so there's no restaurant to message." },
        { status: 409 }
      );
    }
    restaurantId = profile.dedicatedRestaurantId;
  }

  const conversation = await findOrCreateConversation({
    riderId: profile.id,
    party,
    restaurantId,
  });
  await postMessage(conversation.id, 'RIDER', session.user.name ?? null, text);

  const full = await prisma.riderConversation.findUnique({
    where: { id: conversation.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      _count: { select: { messages: true } },
    },
  });
  if (!full) return new Response('Conversation not found', { status: 404 });

  return Response.json({ conversation: serializeConversation(full, 'rider') }, { status: 201 });
}
