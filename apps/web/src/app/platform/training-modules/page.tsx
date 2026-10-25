import { requireCapability } from '@/server/tenancy';
import { can } from '@/server/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { GraduationCap, BookOpen, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { getTrainingShiftGate } from '@/server/platform-settings';
import { listModulesWithStats } from '@/app/api/platform/training-modules/_list';
import { TrainingModulesClient } from './training-modules-client';

export const metadata = { title: 'Platform · Training library' };
export const dynamic = 'force-dynamic';

export default async function PlatformTrainingModulesPage() {
  const session = await requireCapability('cms:read');
  const [rows, shiftGate] = await Promise.all([listModulesWithStats(), getTrainingShiftGate()]);

  const published = rows.filter((m) => m.isActive).length;
  const required = rows.filter((m) => m.isRequired && m.isActive).length;
  const certified = rows.reduce((a, m) => a + m.completedCount, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Training library</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lessons, quizzes and certificates for riders, kitchen staff and restaurant admins.
        </p>
      </header>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Stat icon={BookOpen} label="Published" value={String(published)} tone="primary" />
        <Stat icon={ShieldCheck} label="Required" value={String(required)} tone="warning" />
        <Stat icon={CheckCircle2} label="Current certificates" value={String(certified)} tone="success" />
        <Stat icon={GraduationCap} label="All modules" value={String(rows.length)} tone="muted" />
      </div>

      <TrainingModulesClient
        initial={JSON.parse(JSON.stringify(rows))}
        shiftGate={shiftGate}
        canEdit={session.user.role === 'SUPER_ADMIN'}
        canSeeDashboard={can(session.user.role, 'riders:read')}
      />
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
  tone: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const cls = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-lg leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
