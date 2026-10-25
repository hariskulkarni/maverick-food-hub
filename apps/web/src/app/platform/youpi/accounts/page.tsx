import Link from 'next/link';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { listPendingVpaRequests } from '@/server/pg/receiving-accounts';
import { AccountsClient } from './accounts-client';

export const metadata = { title: 'Platform · Flavrly PG receiving accounts' };
export const dynamic = 'force-dynamic';

/** SUPER_ADMIN only: receiving-account onboarding and verification (contract D7). */
export default async function PgReceivingAccountsPage() {
  const session = await requireSuperAdmin();

  const [accounts, requests, pendingVpa] = await Promise.all([
    prisma.pgReceivingAccount.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        restaurantId: true,
        gatewayMerchantId: true,
        vpa: true,
        legalEntityName: true,
        ifsc: true,
        accountLast4: true,
        status: true,
        verificationMethod: true,
        verifiedAt: true,
        verifiedById: true,
        disabledForNewAt: true,
        createdById: true,
        createdAt: true,
      },
    }),
    prisma.youpiFeatureRequest.findMany({
      where: { status: { in: ['APPROVED', 'REQUESTED'] } },
      select: { restaurantId: true, status: true, restaurant: { select: { name: true } } },
      take: 500,
    }),
    listPendingVpaRequests(),
  ]);
  const names = new Map(
    (
      await prisma.restaurant.findMany({
        where: { id: { in: [...new Set(accounts.map((a) => a.restaurantId))] } },
        select: { id: true, name: true },
      })
    ).map((r) => [r.id, r.name]),
  );

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header>
        <Link href="/platform/youpi" className="text-xs text-primary hover:underline">← Flavrly PG</Link>
        <h1 className="display text-2xl sm:text-3xl font-semibold mt-1">Receiving accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bind each restaurant to one verified gateway merchant id, UPI ID and bank account. A different super admin must
          verify what you register. The bank account number is never stored, only a fingerprint and the last 4 digits.
        </p>
      </header>
      <AccountsClient
        currentUserId={session.user.id}
        restaurants={requests.map((r) => ({ id: r.restaurantId, name: r.restaurant?.name ?? r.restaurantId, featureStatus: r.status }))}
        pendingVpa={pendingVpa}
        accounts={accounts.map((a) => ({
          ...a,
          restaurantName: names.get(a.restaurantId) ?? a.restaurantId,
          verifiedAt: a.verifiedAt?.toISOString() ?? null,
          disabledForNewAt: a.disabledForNewAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
