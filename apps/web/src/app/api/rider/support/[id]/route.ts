/**
 * GET  /api/rider/support/[id] — one ticket (must belong to the rider) with
 *      its full message thread, oldest-first.
 * POST /api/rider/support/[id] — append a rider reply; reopens the ticket if
 *      it was resolved/closed, and bumps it to OPEN so support sees it again.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shared loader — the ticket-with-thread shape both verbs return. */
async function loadThread(ticketId: string) {
  const ticket = await prisma.riderSupportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      riderId: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fromRider: true,
          authorName: true,
          body: true,
          createdAt: true,
        },
      },
    },
  });
  return ticket;
}

function serialize(ticket: NonNullable<Awaited<ReturnType<typeof loadThread>>>) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages.map((m) => ({
      id: m.id,
      fromRider: m.fromRider,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
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

  const ticket = await loadThread(id);
  if (!ticket || ticket.riderId !== profile.id) {
    return new Response('Not found', { status: 404 });
  }

  return Response.json(serialize(ticket));
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

  const existing = await prisma.riderSupportTicket.findUnique({
    where: { id },
    select: { id: true, riderId: true, status: true },
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

  // A new rider reply means the ball is back in support's court. If the ticket
  // was already resolved/closed, reopen it; otherwise just nudge it to OPEN.
  await prisma.$transaction([
    prisma.riderSupportMessage.create({
      data: {
        ticketId: id,
        fromRider: true,
        authorName: session.user.name ?? null,
        body: text.slice(0, 4000),
      },
    }),
    prisma.riderSupportTicket.update({
      where: { id },
      data: { status: 'OPEN' },
    }),
  ]);

  const updated = await loadThread(id);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json(serialize(updated));
}
