import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, CalendarCheck, CalendarX, Clock } from 'lucide-react';
import { RiderShiftsClient } from './rider-shifts-client';
import { serializeShift } from '@/app/api/platform/rider-shifts/_serializers';

export const metadata = { title: 'Platform · Rider Shifts' };
export const dynamic = 'force-dynamic';

export default async function PlatformRiderShiftsPage() {
  await requireCapability('riders:read');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [shifts, upcomingCount, completedCount, missedCount] = await Promise.all([
    prisma.riderShift.findMany({
      orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
      take: 500,
    }),
    prisma.riderShift.count({ where: { date: { gte: today }, status: { in: ['BOOKED', 'STARTED'] } } }),
    prisma.riderShift.count({ where: { status: 'COMPLETED' } }),
    prisma.riderShift.count({ where: { status: 'MISSED' } }),
  ]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider shifts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Booked, active, and past shifts across all riders. Filter by date and status.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={CalendarClock} label="Upcoming / active" value={String(upcomingCount)} tone="primary" />
        <Stat icon={CalendarCheck} label="Completed" value={String(completedCount)} tone="success" />
        <Stat icon={CalendarX} label="Missed" value={String(missedCount)} tone="destructive" />
        <Stat icon={Clock} label="Total shifts" value={String(shifts.length)} tone="muted" />
      </div>

      <RiderShiftsClient initial={JSON.parse(JSON.stringify(shifts.map(serializeShift)))} />
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
