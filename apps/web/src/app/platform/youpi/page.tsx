import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import Link from 'next/link';
import { YoupiAdminClient } from './youpi-client';

export const metadata = { title: 'Platform · Flavrly PG' };
export const dynamic = 'force-dynamic';

/** SUPER_ADMIN only: shared Flavrly PG connection + per-restaurant approvals queue. */
export default async function PlatformYoupiPage() {
  await requireSuperAdmin();

  const [cred, requests] = await Promise.all([
    prisma.integrationCredential.findUnique({
      where: { restaurantId_provider: { restaurantId: '__platform__', provider: 'YOUPI' as any } },
      select: { status: true, summary: true },
    }),
    prisma.youpiFeatureRequest.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 500,
      include: { restaurant: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-2xl sm:text-3xl font-semibold">Flavrly PG</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Experimental UPI gateway pilot. Configure the shared connection, then approve restaurants.
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/platform/youpi/accounts" className="inline-flex min-h-[44px] items-center rounded-md border px-3 font-medium text-primary hover:bg-accent">
            Receiving accounts
          </Link>
          <Link href="/platform/youpi/ops" className="inline-flex min-h-[44px] items-center rounded-md border px-3 font-medium text-primary hover:bg-accent">
            Reconciliation ops
          </Link>
        </nav>
      </header>
      <YoupiAdminClient
        configured={cred?.status === 'CONNECTED'}
        summary={(cred?.summary as Record<string, unknown> | null) ?? null}
        initialRequests={requests.map((r) => ({
          id: r.id,
          restaurantId: r.restaurantId,
          restaurantName: r.restaurant?.name ?? r.restaurantId,
          status: r.status as string,
          requestedAt: r.requestedAt.toISOString(),
        }))}
      />
    </div>
  );
}
