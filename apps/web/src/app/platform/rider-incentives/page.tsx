import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Trophy, Zap, CalendarDays } from 'lucide-react';
import { RiderIncentivesClient } from './rider-incentives-client';

export const metadata = { title: 'Platform · Rider incentives' };
export const dynamic = 'force-dynamic';

export default async function RiderIncentivesPage() {
  const incentives = await prisma.riderIncentive.findMany({ orderBy: { createdAt: 'desc' } });

  const rows = incentives.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    period: i.period,
    targetDeliveries: i.targetDeliveries,
    bonusAmount: Number(i.bonusAmount),
    startsAt: i.startsAt.toISOString(),
    endsAt: i.endsAt ? i.endsAt.toISOString() : null,
    isActive: i.isActive,
    createdAt: i.createdAt.toISOString()
  }));

  const active = rows.filter((r) => r.isActive).length;
  const daily = rows.filter((r) => r.period === 'DAILY').length;
  const weekly = rows.filter((r) => r.period === 'WEEKLY').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider incentives</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define delivery-target slabs that pay riders a flat bonus when they hit the goal within a period.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={Trophy}       label="Active slabs"  value={String(active)} tone="success" />
        <Stat icon={Zap}          label="Daily slabs"   value={String(daily)}  tone="primary" />
        <Stat icon={CalendarDays} label="Weekly slabs"  value={String(weekly)} tone="warning" />
      </div>

      <RiderIncentivesClient initial={rows} />
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
