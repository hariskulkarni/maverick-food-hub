/**
 * Super-admin: revoke a SignupBonusGrant (fraud / abuse remediation).
 *
 *   POST /api/platform/signup-bonus/grants/[id]/revoke
 *     body: { reason: string }
 *
 * Sets revokedAt + revokedReason, writes a REVOKE ledger row with a negative
 * delta equal to the still-unused balance, and audits the action.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireSuperAdmin } from '@/server/tenancy';

const Body = z.object({
  reason: z.string().min(2).max(500)
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;
  const { reason } = Body.parse(await req.json());

  const grant = await (prisma as any).signupBonusGrant.findUnique({ where: { id } });
  if (!grant) return new Response('Grant not found', { status: 404 });
  if (grant.revokedAt) return new Response('Already revoked', { status: 409 });

  const remaining = Math.max(0, Number(grant.totalAmount) - Number(grant.usedAmount));

  const updated = await prisma.$transaction(async (tx: any) => {
    const u = await tx.signupBonusGrant.update({
      where: { id },
      data: { revokedAt: new Date(), revokedReason: reason }
    });
    await tx.signupBonusLedger.create({
      data: {
        grantId: id,
        orderId: null,
        kind: 'REVOKE',
        delta: (-remaining) as any,
        note: `Revoked by super-admin — ${reason}`
      }
    });
    return u;
  });

  await audit('signup_bonus.revoked' as any, {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'SignupBonusGrant',
    entityId: id,
    before: { revokedAt: null },
    after: { revokedAt: updated.revokedAt, revokedReason: reason, voidedAmount: remaining },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true, voidedAmount: remaining });
}
