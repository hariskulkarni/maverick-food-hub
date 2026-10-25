/**
 * GET /api/platform/rider-payouts — every rider withdrawal request, joined to
 * the rider's name/phone. Optional ?status filter (REQUESTED|PROCESSING|PAID|FAILED).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Prisma, RiderPayoutStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = Object.values(RiderPayoutStatus) as string[];

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const status = new URL(req.url).searchParams.get('status') || undefined;
  // P1-6: an unknown ?status= used to reach Prisma and 500.
  if (status && !STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
  }

  const where: Prisma.RiderPayoutWhereInput = {};
  if (status) where.status = status as RiderPayoutStatus;

  const payouts = await prisma.riderPayout.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    take: 500,
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } }
  });

  return Response.json({
    payouts: payouts.map((p) => ({
      id: p.id,
      riderId: p.riderId,
      amount: Number(p.amount),
      status: p.status,
      method: p.method,
      upiId: p.upiId,
      reference: p.reference,
      note: p.note,
      requestedAt: p.requestedAt,
      processedAt: p.processedAt,
      rider: { name: p.rider.user.name, phone: p.rider.user.phone }
    }))
  });
}
