/**
 * GET /api/platform/rider-support — list rider support tickets with message
 * counts + last activity. Super-admin only. Filter by ?status, ?category.
 * Pass ?ticket=<id> to fetch one ticket with its full message thread.
 */
import { NextRequest } from 'next/server';
import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { serializeTicket } from './_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireCapability('riders:read');
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || undefined;
  const category = sp.get('category') || undefined;
  const ticketId = sp.get('ticket') || undefined;

  // Single-ticket detail with full thread.
  if (ticketId) {
    const ticket = await prisma.riderSupportTicket.findUnique({
      where: { id: ticketId },
      include: {
        rider: { include: { user: { select: { name: true, phone: true } } } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) return new Response('Ticket not found', { status: 404 });
    return Response.json({ ticket: serializeTicket(ticket) });
  }

  const where: any = {};
  if (status) where.status = status;
  if (category) where.category = category;

  const tickets = await prisma.riderSupportTicket.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      rider: { include: { user: { select: { name: true, phone: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { messages: true } },
    },
    take: 500,
  });

  return Response.json({ tickets: tickets.map(serializeTicket) });
}
