/**
 * GET /api/platform/kyc — super-admin KYC review queue.
 *
 * Filters:
 *   ?status = PENDING | APPROVED | REJECTED | EXPIRED
 *   ?type   = AADHAAR | DRIVING_LICENSE | VEHICLE_INSURANCE | VEHICLE_RC | PAN_CARD
 *   ?search = matches rider name, phone, vehicle number, or numberLast4
 *   ?take   = page size (default 100, max 500)
 *
 * Document numbers are returned MASKED only — never plaintext.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { toPublicDoc, ALL_KYC_TYPES } from '@/server/kyc';
import { KycDocumentStatus, KycDocumentType, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const ALL_STATUSES: KycDocumentStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const url = new URL(req.url);

  const statusParam = url.searchParams.get('status');
  const typeParam = url.searchParams.get('type');
  const search = (url.searchParams.get('search') ?? '').trim();
  const takeRaw = Number(url.searchParams.get('take') ?? '100');
  const take = Math.max(1, Math.min(500, Number.isFinite(takeRaw) ? takeRaw : 100));

  const where: Prisma.RiderKycDocumentWhereInput = {};
  if (statusParam && ALL_STATUSES.includes(statusParam as KycDocumentStatus)) {
    where.status = statusParam as KycDocumentStatus;
  }
  if (typeParam && ALL_KYC_TYPES.includes(typeParam as KycDocumentType)) {
    where.type = typeParam as KycDocumentType;
  }
  if (search) {
    where.OR = [
      { numberLast4: { contains: search } },
      { rider: { vehicleNumber: { contains: search, mode: 'insensitive' } } },
      { rider: { user: { name:  { contains: search, mode: 'insensitive' } } } },
      { rider: { user: { phone: { contains: search } } } }
    ];
  }

  const docs = await prisma.riderKycDocument.findMany({
    where,
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    take,
    include: {
      rider: {
        select: {
          id: true,
          vehicleType: true,
          vehicleNumber: true,
          user: { select: { id: true, name: true, phone: true, email: true } }
        }
      }
    }
  });

  // Per-status counts for the top strip
  const grouped = await prisma.riderKycDocument.groupBy({
    by: ['status'],
    _count: { _all: true }
  });
  const counts: Record<string, number> = {
    PENDING: 0, APPROVED: 0, REJECTED: 0, EXPIRED: 0
  };
  for (const g of grouped) counts[g.status] = g._count._all;

  return Response.json({
    documents: docs.map((d) => ({
      ...toPublicDoc(d),
      rider: d.rider
    })),
    counts
  });
}
