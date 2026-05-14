import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { LifeBuoy, Inbox, MessageSquare, CheckCircle2 } from 'lucide-react';
import { RiderSupportClient } from './rider-support-client';
import { serializeTicket } from '@/app/api/platform/rider-support/_serializers';

export const metadata = { title: 'Platform · Rider Support' };
export const dynamic = 'force-dynamic';

export default async function PlatformRiderSupportPage() {
  await requireSuperAdmin();

  const [tickets, openCount, inProgressCount, resolvedCount] = await Promise.all([
    prisma.riderSupportTicket.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        rider: { include: { user: { select: { name: true, phone: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      take: 500,
    }),
    prisma.riderSupportTicket.count({ where: { status: 'OPEN' } }),
    prisma.riderSupportTicket.count({ where: { status: { in: ['IN_PROGRESS', 'WAITING_ON_RIDER'] } } }),
    prisma.riderSupportTicket.count({ where: { status: { in: ['RESOLVED', 'CLOSED'] } } }),
  ]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider support</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Support tickets raised by riders. Open a ticket to read the thread and reply.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Inbox} label="Open" value={String(openCount)} tone="warning" />
        <Stat icon={MessageSquare} label="In progress" value={String(inProgressCount)} tone="primary" />
        <Stat icon={CheckCircle2} label="Resolved / closed" value={String(resolvedCount)} tone="success" />
        <Stat icon={LifeBuoy} label="Total tickets" value={String(tickets.length)} tone="muted" />
      </div>

      <RiderSupportClient initial={JSON.parse(JSON.stringify(tickets.map(serializeTicket)))} />
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
