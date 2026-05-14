import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { Gift, Users, CheckCircle2 } from 'lucide-react';
import { RiderReferralsClient, type ReferralRow } from './rider-referrals-client';

export const metadata = { title: 'Platform · Rider referrals' };
export const dynamic = 'force-dynamic';

export default async function RiderReferralsPage() {
  const [referrals, rewardedAgg] = await Promise.all([
    prisma.riderReferral.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { referrer: { include: { user: { select: { name: true, phone: true } } } } }
    }),
    prisma.riderReferral.aggregate({ where: { status: 'REWARDED' }, _sum: { bonusAmount: true }, _count: true })
  ]);

  const rows: ReferralRow[] = referrals.map((r) => ({
    id: r.id,
    referrerId: r.referrerId,
    code: r.code,
    refereePhone: r.refereePhone,
    refereeName: r.refereeName,
    status: r.status,
    bonusAmount: Number(r.bonusAmount),
    createdAt: r.createdAt.toISOString(),
    qualifiedAt: r.qualifiedAt ? r.qualifiedAt.toISOString() : null,
    rewardedAt: r.rewardedAt ? r.rewardedAt.toISOString() : null,
    referrer: { name: r.referrer.user.name, phone: r.referrer.user.phone }
  }));

  const rewardedCount = rewardedAgg._count;
  const rewardedTotal = Number(rewardedAgg._sum.bonusAmount ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider referrals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Refer-a-rider activity. A referrer earns their bonus once the referee signs up and completes qualifying deliveries.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={Users}        label="Total referrals"  value={String(rows.length)}   tone="primary" />
        <Stat icon={CheckCircle2} label="Rewarded"         value={String(rewardedCount)} tone="success" />
        <Stat icon={Gift}         label="Bonus paid out"   value={money(rewardedTotal)}  tone="warning" />
      </div>

      <RiderReferralsClient rows={rows} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'primary' | 'success' | 'warning' }) {
  const cls = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning'
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-lg leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
