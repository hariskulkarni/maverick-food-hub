/**
 * Customer-facing: read your own signup bonus grant snapshot.
 *
 *   GET — returns the active grant's balance/usage/expiry for tracker UI.
 *         Falls back to { hasGrant: false } when no grant exists, the user
 *         is unauthenticated, or the grant has been revoked.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { remainingBalance } from '@/server/signup-bonus';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const grant = await (prisma as any).signupBonusGrant.findUnique({ where: { userId: session.user.id } });
  if (!grant) return Response.json({ hasGrant: false });

  const lite = {
    id: grant.id,
    userId: grant.userId,
    totalAmount: Number(grant.totalAmount),
    perOrderCap: Number(grant.perOrderCap),
    usedAmount: Number(grant.usedAmount),
    pendingAmount: Number(grant.pendingAmount),
    remainingOrders: grant.remainingOrders,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt
  };

  return Response.json({
    hasGrant: true,
    totalAmount:     lite.totalAmount,
    usedAmount:      lite.usedAmount,
    pendingAmount:   lite.pendingAmount,
    remainingBalance: remainingBalance(lite),
    remainingOrders: lite.remainingOrders,
    perOrderCap:     lite.perOrderCap,
    expiresAt:       lite.expiresAt,
    revokedAt:       lite.revokedAt
  });
}
