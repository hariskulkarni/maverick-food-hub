/**
 * Rider support ticket — single-ticket operations (super-admin only).
 *   GET   — fetch the ticket with its full message thread.
 *   POST  — append a support reply (fromRider: false, authorName: 'Support').
 *           Optionally also update the ticket status in the same call.
 *   PATCH — update ticket status only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { serializeTicket } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_RIDER', 'RESOLVED', 'CLOSED'] as const;

async function loadTicket(id: string) {
  return prisma.riderSupportTicket.findUnique({
    where: { id },
    include: {
      rider: { include: { user: { select: { name: true, phone: true } } } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const ticket = await loadTicket(id);
  if (!ticket) return new Response('Ticket not found', { status: 404 });
  return Response.json({ ticket: serializeTicket(ticket) });
}

const ReplyBody = z.object({
  body: z.string().min(1).max(4000),
  status: z.enum(TICKET_STATUSES).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = ReplyBody.parse(await req.json());

  const existing = await prisma.riderSupportTicket.findUnique({ where: { id } });
  if (!existing) return new Response('Ticket not found', { status: 404 });

  await prisma.riderSupportMessage.create({
    data: {
      ticketId: id,
      fromRider: false,
      authorName: 'Support',
      body: data.body,
    },
  });

  // Touch updatedAt (and optionally move status) so the list re-sorts.
  await prisma.riderSupportTicket.update({
    where: { id },
    data: {
      updatedAt: new Date(),
      ...(data.status ? { status: data.status } : {}),
    },
  });

  await audit('rider.support.reply', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderSupportTicket',
    entityId: id,
    after: { reply: data.body.slice(0, 200), status: data.status ?? existing.status },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  const ticket = await loadTicket(id);
  return Response.json({ ticket: serializeTicket(ticket) }, { status: 201 });
}

const PatchBody = z.object({ status: z.enum(TICKET_STATUSES) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await prisma.riderSupportTicket.findUnique({ where: { id } });
  if (!before) return new Response('Ticket not found', { status: 404 });

  await prisma.riderSupportTicket.update({ where: { id }, data: { status: data.status } });

  await audit('rider.support.status', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderSupportTicket',
    entityId: id,
    before: { status: before.status },
    after: { status: data.status },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  const ticket = await loadTicket(id);
  return Response.json({ ticket: serializeTicket(ticket) });
}
