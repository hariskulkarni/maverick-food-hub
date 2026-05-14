/**
 * GET  /api/rider/messages/[id] — one conversation thread (must belong to the
 *      rider). Marks all staff-sent messages as read by the rider.
 * POST /api/rider/messages/[id] — { body } → append a rider reply.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { postMessage, serializeConversation } from '@/server/rider-messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Load a conversation with its full thread + restaurant name. */
async function loadThread(id: string) {
  const conversation = await prisma.riderConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      _count: { select: { messages: true } },
    },
  });
  if (!conversation) return null;
  const restaurantName = conversation.restaurantId
    ? (
        await prisma.restaurant.findUnique({
          where: { id: conversation.restaurantId },
          select: { name: true },
        })
      )?.name ?? null
    : null;
  return { conversation, restaurantName };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const loaded = await loadThread(id);
  if (!loaded || loaded.conversation.riderId !== profile.id) {
    return new Response('Not found', { status: 404 });
  }

  // Opening the thread = the rider has seen everything staff sent.
  await prisma.riderConversationMessage.updateMany({
    where: { conversationId: id, readByRider: false },
    data: { readByRider: true },
  });

  const fresh = await loadThread(id);
  if (!fresh) return new Response('Not found', { status: 404 });
  return Response.json({
    conversation: {
      ...serializeConversation(fresh.conversation, 'rider'),
      restaurantName: fresh.restaurantName,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const existing = await prisma.riderConversation.findUnique({
    where: { id },
    select: { id: true, riderId: true },
  });
  if (!existing || existing.riderId !== profile.id) {
    return new Response('Not found', { status: 404 });
  }

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) {
    return Response.json({ error: 'Reply cannot be empty' }, { status: 400 });
  }

  await postMessage(id, 'RIDER', session.user.name ?? null, text);

  const fresh = await loadThread(id);
  if (!fresh) return new Response('Not found', { status: 404 });
  return Response.json({
    conversation: {
      ...serializeConversation(fresh.conversation, 'rider'),
      restaurantName: fresh.restaurantName,
    },
  });
}
