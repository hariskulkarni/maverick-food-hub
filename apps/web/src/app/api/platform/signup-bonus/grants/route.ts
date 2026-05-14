/**
 * Super-admin: list recent SignupBonusGrants joined to the user.
 *
 *   GET /api/platform/signup-bonus/grants
 *     ?q=phone|email|name (substring)
 *     &issued_after=ISO
 *     &issued_before=ISO
 *     &limit=20 (max 200)
 *
 * Ordered newest first. Used by the platform dashboard to inspect issuance.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { searchParams } = new URL(req.url);
  const q             = searchParams.get('q')?.trim() ?? '';
  const issuedAfter   = searchParams.get('issued_after');
  const issuedBefore  = searchParams.get('issued_before');
  const limit         = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '20')));

  const where: any = {};
  if (issuedAfter)  where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(issuedAfter) };
  if (issuedBefore) where.createdAt = { ...(where.createdAt ?? {}), lte: new Date(issuedBefore) };
  if (q) {
    where.user = {
      OR: [
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { name:  { contains: q, mode: 'insensitive' } }
      ]
    };
  }

  const grants = await (prisma as any).signupBonusGrant.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } }
    }
  });

  return Response.json({ grants });
}
