/**
 * Customer-facing Signup Bonus tracker (server entry).
 *
 * Loads the grant + the latest 25 ledger entries so the timeline can render
 * "Used ₹20 on order MAVE-AB12CD" / "Restored ₹20 because order was cancelled".
 * Redirects to /login if unauthenticated.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { remainingBalance } from '@/server/signup-bonus';
import { SignupBonusClient } from './signup-bonus-client';

export const metadata = { title: 'My Signup Bonus' };
export const dynamic = 'force-dynamic';

export default async function CustomerSignupBonusPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/profile/signup-bonus');

  const grant = await (prisma as any).signupBonusGrant.findUnique({
    where: { userId: session.user.id }
  });

  let ledger: any[] = [];
  if (grant) {
    const rows = await (prisma as any).signupBonusLedger.findMany({
      where: { grantId: grant.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        order: { select: { code: true, status: true } }
      }
    });
    ledger = rows;
  }

  const cfg = await (prisma as any).signupBonusConfig.findUnique({ where: { id: 'singleton' } });

  const view = grant ? {
    hasGrant: true as const,
    totalAmount:      Number(grant.totalAmount),
    perOrderCap:      Number(grant.perOrderCap),
    usedAmount:       Number(grant.usedAmount),
    pendingAmount:    Number(grant.pendingAmount),
    remainingBalance: remainingBalance({
      id: grant.id, userId: grant.userId,
      totalAmount: Number(grant.totalAmount),
      perOrderCap: Number(grant.perOrderCap),
      usedAmount:  Number(grant.usedAmount),
      pendingAmount: Number(grant.pendingAmount),
      remainingOrders: grant.remainingOrders,
      expiresAt: grant.expiresAt, revokedAt: grant.revokedAt
    }),
    remainingOrders:  grant.remainingOrders,
    expiresAt:        grant.expiresAt ? new Date(grant.expiresAt).toISOString() : null,
    revokedAt:        grant.revokedAt ? new Date(grant.revokedAt).toISOString() : null,
    revokedReason:    grant.revokedReason ?? null,
    splitCount:       cfg?.splitCount ?? grant.remainingOrders + Math.max(0, Math.floor(Number(grant.usedAmount) / Math.max(0.01, Number(grant.perOrderCap)))) // best-effort
  } : { hasGrant: false as const };

  return (
    <div className="container py-8">
      <SignupBonusClient
        view={JSON.parse(JSON.stringify(view))}
        ledger={JSON.parse(JSON.stringify(ledger))}
      />
    </div>
  );
}
