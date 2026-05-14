/**
 * GET  /api/platform/messages/[id] — one SUPER_ADMIN conversation thread. Marks
 *      rider-sent messages as read by staff.
 * POST /api/platform/messages/[id] — { body } → append a SUPER_ADMIN reply.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
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
  await requireSuperAdmin();

  const conversation = await loadThread(id);
  if (!conversation || conversation.party !== 'SUPER_ADMIN') {
    return new Response('Not found', { status: 404 });
  }

  await prisma.riderConversationMessage.updateMany({
    where: { conversationId: id, readByStaff: false },
    data: { readByStaff: true },
  });

  const fresh = await loadThread(id);
  if (!fresh) return new Response('Not found', { status: 404 });
  return Response.json({ conversation: serializeConversation(fresh, 'staff') });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSuperAdmin();

  const existing = await prisma.riderConversation.findUnique({
    where: { id },
    select: { id: true, party: true },
  });
  if (!existing || existing.party !== 'SUPER_ADMIN') {
    return new Response('Not found', { status: 404 });
  }

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return Response.json({ error: 'Reply cannot be empty' }, { status: 400 });

  await postMessage(id, 'SUPER_ADMIN', session.user.name ?? 'Platform Ops', text);

  const fresh = await loadThread(id);
  if (!fresh) return new Response('Not found', { status: 404 });
  return Response.json({ conversation: serializeConversation(fresh, 'staff') });
}
