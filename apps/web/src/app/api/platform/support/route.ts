/**
 * GET /api/platform/support
 * Super-admin queue. Filters: status, priority, type, search.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Prisma, TicketStatus, TicketPriority, TicketType } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as TicketStatus | null;
  const priority = url.searchParams.get('priority') as TicketPriority | null;
  const type = url.searchParams.get('type') as TicketType | null;
  const search = url.searchParams.get('search')?.trim();

  const where: Prisma.SupportTicketWhereInput = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { message: { contains: search, mode: 'insensitive' } },
      { resolution: { contains: search, mode: 'insensitive' } },
      { id: { contains: search } },
      { orderId: { contains: search } }
    ];
  }

  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: 500
  });
  return Response.json({ tickets });
}
