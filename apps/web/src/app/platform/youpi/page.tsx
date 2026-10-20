import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { YoupiAdminClient } from './youpi-client';

export const metadata = { title: 'Platform · YouPI' };
export const dynamic = 'force-dynamic';

/** SUPER_ADMIN only: shared YouPI connection + per-restaurant approvals queue. */
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
        <h1 className="display text-2xl sm:text-3xl font-semibold">YouPI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Experimental UPI gateway pilot. Configure the shared connection, then approve restaurants.
        </p>
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
