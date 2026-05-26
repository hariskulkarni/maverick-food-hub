/**
 * PATCH /api/platform/rider-referrals/[id]
 *
 * Advance a rider referral through its lifecycle:
 *   PENDING → SIGNED_UP → QUALIFIED → REWARDED
 *
 * Only forward moves along the ladder are allowed (no skipping backward). When
 * a referral reaches REWARDED, the referrer's bonus is credited to their
 * lifetime earnings exactly once — guarded inside a transaction on the status
 * so a double-submit can't pay twice. `qualifiedAt` / `rewardedAt` are stamped
 * on the respective transitions and every change is audited.
 *
 * Optionally accepts `bonusAmount` to set/override the payout before rewarding.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { RiderReferralStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  status: z.nativeEnum(RiderReferralStatus),
  bonusAmount: z.number().min(0).max(100000).optional()
});

// Lifecycle order — index gives the rung. A move is valid only if it advances.
const ORDER: RiderReferralStatus[] = ['PENDING', 'SIGNED_UP', 'QUALIFIED', 'REWARDED'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const body = Body.parse(await req.json());

  const ref = await prisma.riderReferral.findUnique({ where: { id } });
  if (!ref) return new Response('Not found', { status: 404 });

  const fromIdx = ORDER.indexOf(ref.status);
  const toIdx = ORDER.indexOf(body.status);
  if (toIdx <= fromIdx) {
    return Response.json(
      { ok: false, message: `Cannot move a referral from ${ref.status} to ${body.status}.` },
      { status: 400 }
    );
  }

  const now = new Date();
  const bonus = body.bonusAmount ?? Number(ref.bonusAmount);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  // When advancing to REWARDED, atomically pay the referrer once. The guard
  // `status: { not: 'REWARDED' }` ensures a concurrent/double request can't
  // double-credit.
  let credited = 0;
  await prisma.$transaction(async (tx) => {
    if (body.status === 'REWARDED') {
      const res = await tx.riderReferral.updateMany({
        where: { id, status: { not: 'REWARDED' } },
        data: {
          status: 'REWARDED',
          bonusAmount: bonus as any,
          rewardedAt: now,
          // If we skipped QUALIFIED, stamp it now so the record is coherent.
          qualifiedAt: ref.qualifiedAt ?? now
        }
      });
      if (res.count === 1 && bonus > 0) {
        await tx.riderProfile.update({
          where: { id: ref.referrerId },
          data: { totalEarnings: { increment: bonus as any } }
        });
        credited = bonus;
      }
    } else {
      await tx.riderReferral.update({
        where: { id },
        data: {
          status: body.status,
          ...(body.bonusAmount !== undefined ? { bonusAmount: bonus as any } : {}),
          ...(body.status === 'QUALIFIED' && !ref.qualifiedAt ? { qualifiedAt: now } : {})
        }
      });
    }
  });

  await audit('rider.referral.advance', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderReferral',
    entityId: id,
    before: { status: ref.status },
    after: { status: body.status, bonusCredited: credited },
    ipAddress: ip
  }).catch(() => {});

  return Response.json({ ok: true, status: body.status, bonusCredited: credited });
}
