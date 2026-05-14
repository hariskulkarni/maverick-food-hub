/**
 * Platform-admin Challenges dashboard.
 *
 * Server component. Loads every challenge with its computed `lifecycle` bucket
 * and pre-aggregates two counter maps:
 *   • totalIssued per challenge — via ChallengeReward.groupBy(challengeId)
 *   • completed/total per challenge — via ChallengeProgress.groupBy(challengeId,completed)
 *
 * Counters are hoisted to the server pass so the client renders KPIs and
 * per-card progress bars without follow-up fetches.
 */
import { prisma } from '@/server/db';
import { ChallengesClient } from './challenges-client';

export const metadata = { title: 'Admin · Challenges' };
export const dynamic = 'force-dynamic';

type Lifecycle = 'active' | 'upcoming' | 'expired';

function lifecycle(c: { validFrom: Date | string; validTo: Date | string | null; isActive: boolean }, now: Date): Lifecycle {
  if (!c.isActive) return 'expired';
  const from = new Date(c.validFrom);
  if (from > now) return 'upcoming';
  if (c.validTo && new Date(c.validTo) < now) return 'expired';
  return 'active';
}

export default async function ChallengesPage() {
  const challenges = await (prisma as any).challenge.findMany({
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  // Counters — group rewards & progress by challengeId in one round-trip each.
  const [issuedGroups, progressGroups] = await Promise.all([
    (prisma as any).challengeReward.groupBy({
      by: ['challengeId'],
      _count: { _all: true }
    }),
    (prisma as any).challengeProgress.groupBy({
      by: ['challengeId', 'completed'],
      _count: { _all: true }
    })
  ]);

  const issuedByChallenge = new Map<string, number>(
    (issuedGroups as any[]).map((g) => [g.challengeId, g._count._all])
  );
  const completedByChallenge = new Map<string, number>();
  const totalProgressByChallenge = new Map<string, number>();
  for (const g of progressGroups as any[]) {
    const t = (totalProgressByChallenge.get(g.challengeId) ?? 0) + g._count._all;
    totalProgressByChallenge.set(g.challengeId, t);
    if (g.completed) completedByChallenge.set(g.challengeId, g._count._all);
  }

  // Rewards issued this month (cheap aggregate for one of the KPI tiles).
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const rewardsThisMonth = await (prisma as any).challengeReward.count({
    where: { issuedAt: { gte: monthStart } }
  });

  const now = new Date();
  const enriched = (challenges as any[]).map((c) => ({
    ...c,
    lifecycle: lifecycle(c, now),
    counters: {
      totalIssued: issuedByChallenge.get(c.id) ?? 0,
      completedCount: completedByChallenge.get(c.id) ?? 0,
      participantCount: totalProgressByChallenge.get(c.id) ?? 0
    }
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Challenges</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gamified offers that reward customers for repeat orders. Every reward
          auto-mints an Offer with a unique code the customer can use at
          checkout — the standard Offer engine handles redemption.
        </p>
      </header>
      <ChallengesClient
        challenges={JSON.parse(JSON.stringify(enriched))}
        rewardsThisMonth={rewardsThisMonth}
      />
    </div>
  );
}
