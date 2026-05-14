/**
 * GET  /api/platform/messages — every SUPER_ADMIN-party conversation (rider ⇄
 *      platform ops), newest activity first, plus the full roster of riders so
 *      super-admin can start a chat with anyone.
 * POST /api/platform/messages — { riderId, body } → find-or-create the
 *      SUPER_ADMIN conversation for that rider and append a SUPER_ADMIN message.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
import {
  findOrCreateConversation,
  postMessage,
  serializeConversation,
} from '@/server/rider-messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requireSuperAdmin();

  const [conversations, riders] = await Promise.all([
    prisma.riderConversation.findMany({
      where: { party: 'SUPER_ADMIN' },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.riderProfile.findMany({
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
      orderBy: [{ isOnline: 'desc' }, { totalDeliveries: 'desc' }],
    }),
  ]);

  return Response.json({
    conversations: conversations.map((c) => serializeConversation(c, 'staff')),
    riders: riders.map((r) => ({
      id: r.id,
      name: r.user?.name ?? null,
      phone: r.user?.phone ?? null,
      avatarUrl: r.user?.avatarUrl ?? null,
      isOnline: r.isOnline,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();

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
    party: 'SUPER_ADMIN',
    restaurantId: null,
  });
  await postMessage(
    conversation.id,
    'SUPER_ADMIN',
    session.user.name ?? 'Platform Ops',
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
  if (!full) return new Response('Conversation not found', { status: 404 });

  return Response.json({ conversation: serializeConversation(full, 'staff') }, { status: 201 });
}
