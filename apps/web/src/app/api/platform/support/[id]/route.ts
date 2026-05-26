/**
 * PATCH /api/platform/support/[id]
 * Update status, priority, assignment, or resolution. Marking RESOLVED
 * stamps resolvedAt so we can report time-to-resolve.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { TicketStatus, TicketPriority } from '@prisma/client';

const Body = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedTo: z.string().nullable().optional(),
  resolution: z.string().max(2000).nullable().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const body = Body.parse(await req.json());

  const before = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, status: true, priority: true, assignedTo: true, resolution: true }
  });
  if (!before) return new Response('Not found', { status: 404 });

  const data: any = { ...body };
  if (body.status === TicketStatus.RESOLVED || body.status === TicketStatus.CLOSED) {
    data.resolvedAt = new Date();
  }

  const ticket = await prisma.supportTicket.update({ where: { id }, data });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  await audit('support.ticket.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'SupportTicket',
    entityId: id,
    before,
    after: {
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo,
      resolution: ticket.resolution
    },
    ipAddress: ip
  }).catch(() => {});

  return Response.json({ ticket });
}
