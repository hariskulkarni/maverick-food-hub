import Link from 'next/link';
import { requireSuperAdmin } from '@/server/tenancy';
import { loadPlatformPgOps, type Jsonified, type PlatformPgOps } from '@/server/pg/dashboards';
import { OpsClient } from './ops-client';

export const metadata = { title: 'Platform · Flavrly PG reconciliation ops' };
export const dynamic = 'force-dynamic';

/** SUPER_ADMIN only: cross-tenant exception queue, dual-control bank entry/allocation, worker health. */
export default async function PgOpsPage() {
  const session = await requireSuperAdmin();
  const ops = JSON.parse(JSON.stringify(await loadPlatformPgOps())) as Jsonified<PlatformPgOps>;
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header>
        <Link href="/platform/youpi" className="text-xs text-primary hover:underline">← Flavrly PG</Link>
        <h1 className="display text-2xl sm:text-3xl font-semibold mt-1">Reconciliation ops</h1>
        <p className="text-sm text-muted-foreground mt-1">
          No authorized live bank feed exists, so bank evidence arrives by statement upload or dual-control manual entry.
          Every manual step needs a second super admin.
        </p>
      </header>
      <OpsClient currentUserId={session.user.id} ops={ops} />
    </div>
  );
}
