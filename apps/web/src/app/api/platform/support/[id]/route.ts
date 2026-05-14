/**
 * PATCH /api/platform/support/[id]
 * Update status, priority, assignment, or resolution. Marking RESOLVED
 * stamps resolvedAt so we can report time-to-resolve.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { TicketStatus, TicketPriority } from '@prisma/client';

const Body = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedTo: z.string().nullable().optional(),
  resolution: z.string().max(2000).nullable().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const body = Body.parse(await req.json());

  const data: any = { ...body };
  if (body.status === TicketStatus.RESOLVED || body.status === TicketStatus.CLOSED) {
    data.resolvedAt = new Date();
  }

  const ticket = await prisma.supportTicket.update({ where: { id }, data });
  return Response.json({ ticket });
}
