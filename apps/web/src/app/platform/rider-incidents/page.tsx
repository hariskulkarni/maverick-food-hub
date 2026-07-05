import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldAlert, FolderOpen, Eye, CheckCircle2 } from 'lucide-react';
import { RiderIncidentsClient } from './rider-incidents-client';
import { serializeIncident } from '@/app/api/platform/rider-incidents/_serializers';

export const metadata = { title: 'Platform · Rider Incidents' };
export const dynamic = 'force-dynamic';

export default async function PlatformRiderIncidentsPage() {
  await requireCapability('riders:read');

  const [incidents, openCount, reviewCount, resolvedCount] = await Promise.all([
    prisma.riderIncidentReport.findMany({
      orderBy: { createdAt: 'desc' },
      include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
      take: 500,
    }),
    prisma.riderIncidentReport.count({ where: { status: 'OPEN' } }),
    prisma.riderIncidentReport.count({ where: { status: 'UNDER_REVIEW' } }),
    prisma.riderIncidentReport.count({ where: { status: { in: ['RESOLVED', 'CLOSED'] } } }),
  ]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider incident reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Accidents, breakdowns, harassment, and disputes reported by riders. Triage, review, and resolve.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={FolderOpen} label="Open" value={String(openCount)} tone="warning" />
        <Stat icon={Eye} label="Under review" value={String(reviewCount)} tone="primary" />
        <Stat icon={CheckCircle2} label="Resolved / closed" value={String(resolvedCount)} tone="success" />
        <Stat icon={ShieldAlert} label="Total reports" value={String(incidents.length)} tone="muted" />
      </div>

      <RiderIncidentsClient initial={JSON.parse(JSON.stringify(incidents.map(serializeIncident)))} />
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
