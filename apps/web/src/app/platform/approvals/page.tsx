import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { can } from '@/server/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { ClipboardCheck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { ApprovalsClient } from './approvals-client';

export const metadata = { title: 'Platform · Approvals' };
export const dynamic = 'force-dynamic';

/**
 * Maker-checker approval queue. A reviewer (SUPER_ADMIN) sees every request and
 * can approve/reject; a requester (Admin Assist) sees the status of their own.
 */
export default async function ApprovalsPage() {
  const session = await requireCapability('platform:view');
  const role = (session.user as { role?: string }).role;
  const reviewer = can(role, 'approvals:review');

  const requests = await prisma.approvalRequest.findMany({
    where: reviewer ? {} : { requestedById: session.user.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      requestedBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
  });

  const rows = requests.map((r) => ({
    id: r.id,
    action: r.action,
    capability: r.capability,
    status: r.status as string,
    summary: r.summary,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    requestedBy: r.requestedBy?.name ?? r.requestedBy?.email ?? 'Unknown',
    reviewedBy: r.reviewedBy?.name ?? r.reviewedBy?.email ?? null,
    reviewNote: r.reviewNote,
    executionError: r.executionError,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  }));

  const pending = rows.filter((r) => r.status === 'PENDING').length;
  const approved = rows.filter((r) => r.status === 'APPROVED').length;
  const rejected = rows.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {reviewer
            ? 'Confidential actions awaiting your sign-off, and the decisions already made.'
            : 'Confidential actions you’ve requested. A super-admin approves them before they run.'}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Clock} label="Pending" value={pending} color="warning" />
        <StatCard icon={CheckCircle2} label="Approved" value={approved} color="success" />
        <StatCard icon={XCircle} label="Rejected" value={rejected} color="destructive" />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ClipboardCheck className="size-8 mx-auto mb-2 opacity-50" />
            Nothing here yet. {reviewer ? 'Requests will appear when a team member submits a confidential action.' : 'Trigger a confidential action (e.g. suspend a restaurant) and it will show up here.'}
          </CardContent>
        </Card>
      ) : (
        <ApprovalsClient initial={rows} reviewer={reviewer} />
      )}
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
