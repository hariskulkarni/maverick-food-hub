/**
 * GET /api/admin/reservations          — list this branch's reservations
 * GET /api/admin/reservations?status=X — filter to a single status
 *
 * Upcoming-first ordering (soonest reservedAt first). Scoped to the signed-in
 * admin's primary branch. ADMIN only.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { ReservationStatus } from '@prisma/client';
import { primaryBranchForCurrentRestaurant, serialize } from './_helpers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();

  const statusParam = req.nextUrl.searchParams.get('status');
  const where: any = { branchId: branch.id };
  if (statusParam && (Object.values(ReservationStatus) as string[]).includes(statusParam)) {
    where.status = statusParam;
  }

  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { reservedAt: 'asc' },
    include: {
      table: { select: { id: true, name: true, capacity: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } }
    }
  });

  return Response.json({ branchId: branch.id, reservations: serialize(reservations) });
}
