import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { GraduationCap, BookOpen, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { TrainingModulesClient } from './training-modules-client';
import { serializeModule } from '@/app/api/platform/training-modules/_serializers';

export const metadata = { title: 'Platform · Training Modules' };
export const dynamic = 'force-dynamic';

export default async function PlatformTrainingModulesPage() {
  await requireCapability('cms:read');

  const [modules, completedGroups, totalGroups] = await Promise.all([
    prisma.trainingModule.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] }),
    prisma.riderTrainingProgress.groupBy({
      by: ['moduleId'],
      where: { completed: true },
      _count: { _all: true },
    }),
    prisma.riderTrainingProgress.groupBy({ by: ['moduleId'], _count: { _all: true } }),
  ]);

  const completedMap = new Map(completedGroups.map((g) => [g.moduleId, g._count._all]));
  const totalMap = new Map(totalGroups.map((g) => [g.moduleId, g._count._all]));

  const rows = modules.map((m) =>
    serializeModule(m, { completed: completedMap.get(m.id) ?? 0, total: totalMap.get(m.id) ?? 0 })
  );

  const activeCount = modules.filter((m) => m.isActive).length;
  const requiredCount = modules.filter((m) => m.isRequired).length;
  const totalCompletions = [...completedMap.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Training modules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Onboarding, safety, and skill content delivered to riders. Create, edit, and track completion.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={BookOpen} label="Active modules" value={String(activeCount)} tone="primary" />
        <Stat icon={ShieldCheck} label="Required" value={String(requiredCount)} tone="warning" />
        <Stat icon={CheckCircle2} label="Total completions" value={String(totalCompletions)} tone="success" />
        <Stat icon={GraduationCap} label="All modules" value={String(modules.length)} tone="muted" />
      </div>

      <TrainingModulesClient initial={JSON.parse(JSON.stringify(rows))} />
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
