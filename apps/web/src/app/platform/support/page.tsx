/**
 * Platform · Support tickets
 * Stats strip + filter chips + table with detail drawer for actions.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { LifeBuoy } from 'lucide-react';
import { SupportClient } from './support-client';

export const metadata = { title: 'Platform · Support' };
export const dynamic = 'force-dynamic';

export default async function PlatformSupportPage() {
  await requireSuperAdmin();

  const [tickets, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 500
    }),
    prisma.supportTicket.groupBy({ by: ['status'], _count: true })
  ]);

  const stats = {
    OPEN: counts.find((c: any) => c.status === 'OPEN')?._count ?? 0,
    IN_PROGRESS: counts.find((c: any) => c.status === 'IN_PROGRESS')?._count ?? 0,
    RESOLVED: counts.find((c: any) => c.status === 'RESOLVED')?._count ?? 0,
    CLOSED: counts.find((c: any) => c.status === 'CLOSED')?._count ?? 0
  };

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2"><LifeBuoy className="size-7 text-primary" /> Support tickets</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Customer, rider, and restaurant tickets. Triage, assign, and resolve.
        </p>
      </header>

      <SupportClient initial={JSON.parse(JSON.stringify(tickets))} stats={stats} />
    </div>
  );
}
