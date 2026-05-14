import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { Wallet, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { RiderPayoutsClient } from './rider-payouts-client';

export const metadata = { title: 'Platform · Rider payouts' };
export const dynamic = 'force-dynamic';

export default async function RiderPayoutsPage() {
  const [payouts, requestedAgg, processingAgg, paidAgg, failedCount] = await Promise.all([
    prisma.riderPayout.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 500,
      include: { rider: { include: { user: { select: { name: true, phone: true } } } } }
    }),
    prisma.riderPayout.aggregate({ where: { status: 'REQUESTED' }, _sum: { amount: true }, _count: true }),
    prisma.riderPayout.aggregate({ where: { status: 'PROCESSING' }, _sum: { amount: true }, _count: true }),
    prisma.riderPayout.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
    prisma.riderPayout.count({ where: { status: 'FAILED' } })
  ]);

  const rows = payouts.map((p) => ({
    id: p.id,
    riderId: p.riderId,
    amount: Number(p.amount),
    status: p.status,
    method: p.method,
    upiId: p.upiId,
    reference: p.reference,
    note: p.note,
    requestedAt: p.requestedAt.toISOString(),
    processedAt: p.processedAt ? p.processedAt.toISOString() : null,
    rider: { name: p.rider.user.name, phone: p.rider.user.phone }
  }));

  const kpi = {
    requested: Number(requestedAgg._sum.amount ?? 0),
    requestedCount: requestedAgg._count,
    processing: Number(processingAgg._sum.amount ?? 0),
    processingCount: processingAgg._count,
    paid: Number(paidAgg._sum.amount ?? 0),
    failed: failedCount
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider payouts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Instant-withdrawal requests from riders. Settle a request once the money has been sent — or mark it failed.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Clock}        label={`Requested · ${kpi.requestedCount}`}   value={money(kpi.requested)}  tone="warning" />
        <Stat icon={Wallet}       label={`Processing · ${kpi.processingCount}`} value={money(kpi.processing)} tone="primary" />
        <Stat icon={CheckCircle2} label="Paid · lifetime"                       value={money(kpi.paid)}       tone="success" />
        <Stat icon={XCircle}      label="Failed"                                value={String(kpi.failed)}    tone="destructive" />
      </div>

      <RiderPayoutsClient initial={rows} />
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
