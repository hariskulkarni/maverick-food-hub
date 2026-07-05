import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, UserCog, Wrench, TestTube, Eye } from 'lucide-react';
import {
  ASSIGNABLE_PLATFORM_ROLES,
  capabilitiesFor,
  ROLE_LABEL,
} from '@/server/permissions';
import type { Role } from '@prisma/client';
import { IamConsole } from './iam-console';

export const metadata = { title: 'Platform · IAM' };
export const dynamic = 'force-dynamic';

/**
 * Identity & Access Management — the SUPER_ADMIN surface for creating
 * platform-team users and assigning their roles (Admin Assist / Developer /
 * QA / Guest). Gated by the `iam:manage` capability (super-admin only).
 */
export default async function IamPage() {
  await requireCapability('iam:manage');

  const visibleRoles = ['SUPER_ADMIN', ...ASSIGNABLE_PLATFORM_ROLES] as unknown as Role[];
  const users = await prisma.user.findMany({
    where: { role: { in: visibleRoles }, deletedAt: null },
    orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, email: true, role: true,
      suspendedAt: true, suspendedReason: true, createdAt: true,
    },
  });

  const rows = users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
    capabilities: capabilitiesFor(u.role),
    editable: (ASSIGNABLE_PLATFORM_ROLES as unknown as string[]).includes(u.role),
  }));

  const assignable = (ASSIGNABLE_PLATFORM_ROLES as unknown as Role[]).map((r) => ({
    role: r as string,
    label: ROLE_LABEL[r] ?? String(r),
    capabilities: capabilitiesFor(r),
  }));

  const counts: Record<string, number> = {};
  for (const u of users) counts[u.role] = (counts[u.role] ?? 0) + 1;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Identity &amp; Access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create platform-team members and assign what they can do. You control the IAM of every business.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={UserCog}    label="Admin Assist" value={counts.ADMIN_ASSIST ?? 0} color="primary" />
        <StatCard icon={Wrench}     label="Developers"   value={counts.DEVELOPER ?? 0}    color="primary" />
        <StatCard icon={TestTube}   label="QA"           value={counts.QA ?? 0}           color="warning" />
        <StatCard icon={Eye}        label="Guests"       value={counts.GUEST ?? 0}        color="success" />
      </div>

      <IamConsole initial={rows} assignable={assignable} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: 'primary' | 'success' | 'warning' | 'destructive' }) {
  const cls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', destructive: 'bg-destructive/10 text-destructive' }[color];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-xl leading-tight">{value.toLocaleString('en-IN')}</div>
        </div>
      </CardContent>
    </Card>
  );
}
