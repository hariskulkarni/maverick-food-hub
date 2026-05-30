/**
 * GET  /api/admin/messages/[id] — one ADMIN conversation thread. Must belong to
 *      this admin's restaurant. Marks rider-sent messages as read by staff.
 * POST /api/admin/messages/[id] — { body } → append an ADMIN reply.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { postMessage, serializeConversation } from '@/server/rider-messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadThread(id: string) {
  return prisma.riderConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
      _count: { select: { messages: true } },
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  const conversation = await loadThread(id);
  if (
    !conversation ||
    conversation.party !== 'ADMIN' ||
    conversation.restaurantId !== restaurant.id
  ) {
    return Response.json({ error: 'Conversation not found', reason: 'not_found' }, { status: 404 });
  }

  // Opening the thread = staff has seen everything the rider sent.
  await prisma.riderConversationMessage.updateMany({
    where: { conversationId: id, readByStaff: false },
    data: { readByStaff: true },
  });

  const fresh = await loadThread(id);
  if (!fresh) return Response.json({ error: 'Conversation not found', reason: 'not_found' }, { status: 404 });
  return Response.json({ conversation: serializeConversation(fresh, 'staff') });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();

  const existing = await prisma.riderConversation.findUnique({
    where: { id },
    select: { id: true, party: true, restaurantId: true },
  });
  if (!existing || existing.party !== 'ADMIN' || existing.restaurantId !== restaurant.id) {
    return Response.json({ error: 'Conversation not found', reason: 'not_found' }, { status: 404 });
  }

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return Response.json({ error: 'Reply cannot be empty' }, { status: 400 });

  await postMessage(id, 'ADMIN', restaurant.name ?? session.user.name ?? null, text);

  const fresh = await loadThread(id);
  if (!fresh) return Response.json({ error: 'Conversation not found', reason: 'not_found' }, { status: 404 });
  return Response.json({ conversation: serializeConversation(fresh, 'staff') });
}
