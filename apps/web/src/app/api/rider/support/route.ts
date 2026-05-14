/**
 * GET  /api/rider/support — the rider's support tickets, newest-updated first,
 *      each with a message count and last-message preview.
 * POST /api/rider/support — open a new ticket plus its first message.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import type { RiderTicketCategory } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES: RiderTicketCategory[] = [
  'PAYMENT',
  'APP_BUG',
  'ORDER_ISSUE',
  'KYC',
  'ACCOUNT',
  'SAFETY',
  'OTHER',
];

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const tickets = await prisma.riderSupportTicket.findMany({
    where: { riderId: profile.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, fromRider: true, createdAt: true },
      },
    },
  });

  return Response.json({
    tickets: tickets.map((t) => {
      const last = t.messages[0] ?? null;
      return {
        id: t.id,
        subject: t.subject,
        category: t.category,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        messageCount: t._count.messages,
        lastMessage: last
          ? {
              body: last.body,
              fromRider: last.fromRider,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
      };
    }),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  let body: { subject?: unknown; category?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const category =
    typeof body.category === 'string' &&
    CATEGORIES.includes(body.category as RiderTicketCategory)
      ? (body.category as RiderTicketCategory)
      : 'OTHER';

  if (!subject) {
    return Response.json({ error: 'A subject is required' }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: 'Describe your issue to open a ticket' }, { status: 400 });
  }

  const ticket = await prisma.riderSupportTicket.create({
    data: {
      riderId: profile.id,
      subject: subject.slice(0, 200),
      category,
      status: 'OPEN',
      messages: {
        create: {
          fromRider: true,
          authorName: session.user.name ?? null,
          body: message.slice(0, 4000),
        },
      },
    },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return Response.json(
    {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messageCount: ticket._count.messages,
    },
    { status: 201 }
  );
}
