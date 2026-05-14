/**
 * /platform/live-ops — Super-Admin Live Operations dashboard.
 *
 * The single most important business surface for ops staff. Renders a hero KPI
 * strip of escalation buckets, then a stack of OPEN+ACKNOWLEDGED alert cards
 * that admins acknowledge or resolve. Backed by the stuck-order detector at
 * /api/platform/escalations/scan.
 */
import { Card, CardContent } from '@/components/ui/card';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { LiveOpsClient } from './live-ops-client';
import { AlertTriangle, Flame, AlertOctagon, Activity, CheckCircle2 } from 'lucide-react';
import { money } from '@/lib/utils';

export const metadata = { title: 'Platform · Live ops' };
export const dynamic = 'force-dynamic';

export default async function PlatformLiveOpsPage() {
  await requireSuperAdmin();

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [
    escalations,
    severityCounts,
    resolvedToday,
    onlineRiders,
    totalRiders,
    pausedBranches,
    pendingPayment,
    codPendingAgg
  ] = await Promise.all([
    prisma.orderEscalation.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      include: {
        order: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            branch: { include: { restaurant: { select: { id: true, name: true } } } },
            assignment: { include: { rider: { include: { user: { select: { name: true, phone: true } } } } } }
          }
        }
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: 200
    }),
    prisma.orderEscalation.groupBy({
      by: ['severity'],
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      _count: true
    }),
    prisma.orderEscalation.count({
      where: { status: 'RESOLVED', resolvedAt: { gte: today } }
    }),
    prisma.riderProfile.count({ where: { isOnline: true } }),
    prisma.riderProfile.count(),
    prisma.branch.count({ where: { isActive: false } }),
    prisma.order.count({ where: { status: 'PAYMENT_PENDING' } }),
    prisma.codCollection.aggregate({
      where: { status: { in: ['PENDING_COLLECTION', 'PARTIAL_COLLECTED', 'DEPOSIT_PENDING'] } },
      _sum: { amountToCollect: true },
      _count: true
    })
  ]);

  const sevMap: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of severityCounts) sevMap[row.severity] = row._count;

  const counts = {
    critical: sevMap.CRITICAL,
    high: sevMap.HIGH,
    medium: sevMap.MEDIUM,
    low: sevMap.LOW,
    resolvedToday,
    onlineRiders,
    totalRiders,
    pausedBranches,
    pendingPayment,
    codPendingCount: codPendingAgg._count,
    codPendingSum: Number(codPendingAgg._sum.amountToCollect ?? 0)
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold flex items-center gap-2">
            <span className="relative inline-flex">
              <AlertTriangle className="size-7 text-destructive" />
              {counts.critical > 0 && (
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-destructive pulse-soft" />
              )}
            </span>
            Live operations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every stuck order, surfaced as an alert. Acknowledge to claim, resolve when the order moves.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <SideStat label="Riders online" value={`${counts.onlineRiders} / ${counts.totalRiders}`} />
          <SideStat label="Paused branches" value={counts.pausedBranches} tone={counts.pausedBranches > 0 ? 'warning' : undefined} />
          <SideStat label="Payment pending" value={counts.pendingPayment} tone={counts.pendingPayment > 0 ? 'warning' : undefined} />
          <SideStat label="COD pending" value={`${counts.codPendingCount} · ${money(counts.codPendingSum)}`} />
        </div>
      </header>

      {/* Hero KPI strip */}
      <div className="grid gap-4 md:grid-cols-5">
        <KpiTile icon={Flame}        label="Critical"        value={counts.critical}      tone="critical" pulse={counts.critical > 0} />
        <KpiTile icon={AlertOctagon} label="High"            value={counts.high}          tone="high" />
        <KpiTile icon={AlertTriangle} label="Medium"         value={counts.medium}        tone="medium" />
        <KpiTile icon={Activity}     label="Low"             value={counts.low}           tone="low" />
        <KpiTile icon={CheckCircle2} label="Resolved today"  value={counts.resolvedToday} tone="success" />
      </div>

      <LiveOpsClient
        initial={JSON.parse(JSON.stringify(escalations))}
      />
    </div>
  );
}

function KpiTile({
  icon: Icon, label, value, tone, pulse
}: {
  icon: any;
  label: string;
  value: number;
  tone: 'critical' | 'high' | 'medium' | 'low' | 'success';
  pulse?: boolean;
}) {
  const cls = {
    critical: 'bg-destructive/10 text-destructive border-destructive/40',
    high:     'bg-warning/10 text-warning border-warning/40',
    medium:   'bg-yellow-500/10 text-yellow-600 border-yellow-500/40 dark:text-yellow-400',
    low:      'bg-muted text-muted-foreground border-border',
    success:  'bg-success/10 text-success border-success/40'
  }[tone];
  return (
    <Card className={`border-2 ${cls.replace(/bg-[^\s]+/, '').replace(/text-[^\s]+/, '')}`}>
      <CardContent className={`p-4 flex items-center gap-3 rounded-md ${cls}`}>
        <div className="relative grid size-11 place-items-center rounded-lg bg-card/70 shrink-0">
          <Icon className="size-5" />
          {pulse && <span className="absolute inset-0 rounded-lg pulse-soft border-2 border-current" />}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-75 font-medium">{label}</div>
          <div className="font-bold text-3xl leading-none tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SideStat({ label, value, tone }: { label: string; value: string | number; tone?: 'warning' }) {
  const cls = tone === 'warning' ? 'border-warning/40 bg-warning/5 text-warning' : 'border-border bg-card text-foreground';
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${cls}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}
