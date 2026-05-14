import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { Coins, Wallet, AlertTriangle, PiggyBank } from 'lucide-react';
import { CodClient } from './cod-client';

export const metadata = { title: 'Platform · COD' };
export const dynamic = 'force-dynamic';

export default async function PlatformCodPage() {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  const [collections, riders, pendingAgg, collectedTodayAgg, depositPendingAgg, mismatchCount] = await Promise.all([
    prisma.codCollection.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { code: true, total: true } },
        rider: { include: { user: { select: { name: true, phone: true } } } }
      },
      take: 500
    }),
    prisma.riderProfile.findMany({
      where: { approvedAt: { not: null } },
      orderBy: { user: { name: 'asc' } },
      include: { user: { select: { name: true, phone: true } } }
    }),
    prisma.codCollection.aggregate({
      where: { status: { in: ['PENDING_COLLECTION', 'PARTIAL_COLLECTED'] } },
      _sum: { amountToCollect: true }
    }),
    prisma.codCollection.aggregate({
      where: { collectedAt: { gte: startOfToday }, status: { in: ['COLLECTED', 'PARTIAL_COLLECTED', 'DEPOSIT_PENDING', 'RECONCILED'] } },
      _sum: { amountCollected: true }
    }),
    prisma.codCollection.aggregate({
      where: { status: 'DEPOSIT_PENDING' },
      _sum: { amountCollected: true }
    }),
    prisma.codCollection.count({ where: { status: 'MISMATCH' } })
  ]);

  const kpi = {
    pending: Number(pendingAgg._sum.amountToCollect ?? 0),
    collectedToday: Number(collectedTodayAgg._sum.amountCollected ?? 0),
    depositPending: Number(depositPendingAgg._sum.amountCollected ?? 0),
    mismatches: mismatchCount
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Cash on delivery</h1>
        <p className="text-sm text-muted-foreground mt-1">Track money in rider hands, deposits to the company account, and reconcile mismatches.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Coins}          label="Pending collection" value={money(kpi.pending)}        tone="warning" />
        <Stat icon={Wallet}         label="Collected today"    value={money(kpi.collectedToday)} tone="success" />
        <Stat icon={PiggyBank}      label="Deposit pending"    value={money(kpi.depositPending)} tone="primary" />
        <Stat icon={AlertTriangle}  label="Mismatches"         value={String(kpi.mismatches)}    tone="destructive" />
      </div>

      <CodClient
        initial={JSON.parse(JSON.stringify(collections))}
        riders={JSON.parse(JSON.stringify(riders.map((r: any) => ({ id: r.id, name: r.user.name, phone: r.user.phone }))))}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'primary' | 'success' | 'warning' | 'destructive' }) {
  const cls = {
    primary:     'bg-primary/10 text-primary',
    success:     'bg-success/10 text-success',
    warning:     'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive'
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
