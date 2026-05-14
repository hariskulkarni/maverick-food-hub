/**
 * Super-admin: Signup Bonus configuration screen (server entry).
 *
 * Loads the singleton config + a rolling 30-day issuance summary (grants
 * issued, total credited, total revoked, abuse-refusal flag count) and hands
 * everything to the client editor. The config row is created on first read
 * so the editor always has defaults to render.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { SignupBonusClient } from './signup-bonus-client';

export const metadata = { title: 'Platform · Signup bonus' };
export const dynamic = 'force-dynamic';

const DEFAULTS = {
  id: 'singleton',
  isActive: false,
  totalAmount: 100 as any,
  splitCount: 5,
  perOrderCap: null as any,
  minOrderValue: null as any,
  phoneCheckEnabled: true,
  ipCheckEnabled: true,
  deviceCheckEnabled: false,
  validityDays: 90
};

export default async function PlatformSignupBonusPage() {
  await requireSuperAdmin();

  // Singleton — create on first read so the editor never starts blank.
  let cfg = await (prisma as any).signupBonusConfig.findUnique({ where: { id: 'singleton' } });
  if (!cfg) cfg = await (prisma as any).signupBonusConfig.create({ data: DEFAULTS });

  const sinceDate = new Date(Date.now() - 30 * 86_400_000);

  const [grantsIssued, totalsAgg, revokedCount, refusedCount, recentGrants] = await Promise.all([
    (prisma as any).signupBonusGrant.count({ where: { createdAt: { gte: sinceDate } } }),
    (prisma as any).signupBonusGrant.aggregate({
      _sum: { totalAmount: true, usedAmount: true },
      where: { createdAt: { gte: sinceDate } }
    }),
    (prisma as any).signupBonusGrant.count({ where: { revokedAt: { gte: sinceDate } } }),
    prisma.auditLog.count({
      where: { action: 'signup_bonus.refused', createdAt: { gte: sinceDate } }
    }),
    (prisma as any).signupBonusGrant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { id: true, name: true, phone: true, email: true } } }
    })
  ]);

  const stats = {
    grantsIssued,
    totalCredited: Number(totalsAgg._sum?.totalAmount ?? 0),
    totalUsed:     Number(totalsAgg._sum?.usedAmount ?? 0),
    revokedCount,
    refusedCount
  };

  return (
    <SignupBonusClient
      config={JSON.parse(JSON.stringify(cfg))}
      stats={stats}
      recentGrants={JSON.parse(JSON.stringify(recentGrants))}
    />
  );
}
