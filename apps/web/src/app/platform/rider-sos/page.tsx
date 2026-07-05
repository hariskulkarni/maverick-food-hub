import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Siren, AlertOctagon, CheckCircle2, Ban } from 'lucide-react';
import { RiderSosClient } from './rider-sos-client';
import { serializeSos } from '@/app/api/platform/rider-sos/_serializers';

export const metadata = { title: 'Platform · Rider SOS' };
export const dynamic = 'force-dynamic';

export default async function PlatformRiderSosPage() {
  await requireCapability('riders:read');

  const [alerts, activeCount, resolvedCount, cancelledCount] = await Promise.all([
    prisma.sosAlert.findMany({
      orderBy: [{ triggeredAt: 'desc' }],
      include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
      take: 500,
    }),
    prisma.sosAlert.count({ where: { status: 'ACTIVE' } }),
    prisma.sosAlert.count({ where: { status: 'RESOLVED' } }),
    prisma.sosAlert.count({ where: { status: 'CANCELLED' } }),
  ]);

  const rows = alerts.map(serializeSos).sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
    return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider SOS alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Emergency alerts triggered by riders in the field. Active alerts are pinned to the top — respond fast.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={AlertOctagon} label="Active now" value={String(activeCount)} tone="destructive" />
        <Stat icon={CheckCircle2} label="Resolved" value={String(resolvedCount)} tone="success" />
        <Stat icon={Ban} label="Cancelled" value={String(cancelledCount)} tone="muted" />
        <Stat icon={Siren} label="Total alerts" value={String(rows.length)} tone="primary" />
      </div>

      <RiderSosClient initial={JSON.parse(JSON.stringify(rows))} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone: 'primary' | 'success' | 'warning' | 'destructive' | 'muted';
}) {
  const cls = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-lg leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
