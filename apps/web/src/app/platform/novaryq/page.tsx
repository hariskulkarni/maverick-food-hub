import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { novaryqFlagOn } from '@/server/novaryq/config';
import { computeHealth, type Health } from '@/server/novaryq/admin';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'Platform · Novaryq POS' };
export const dynamic = 'force-dynamic';

const when = (d: Date | null | undefined) =>
  d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';

/**
 * Read-only Novaryq POS status across restaurants. Credentials and replays stay with
 * each restaurant's admin (/admin/integrations); nothing here changes tenant data.
 */
export default async function PlatformNovaryqPage() {
  await requireSuperAdmin();
  const [creds, syncCounts, webhookLast, problems, locationCounts, itemCounts, retryingRows] = await Promise.all([
    prisma.integrationCredential.findMany({
      where: { provider: 'NOVARYQ' },
      select: { restaurantId: true, status: true, summary: true, lastTestedAt: true, lastError: true, restaurant: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.novaryqOrderSync.groupBy({ by: ['restaurantId', 'state'], _count: { _all: true } }),
    prisma.novaryqWebhookEvent.groupBy({ by: ['restaurantId'], _max: { receivedAt: true } }),
    prisma.novaryqOrderSync.findMany({
      where: { state: { in: ['FAILED', 'DEAD'] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, state: true, attempts: true, lastError: true, updatedAt: true, restaurant: { select: { name: true } }, order: { select: { code: true } } },
    }),
    prisma.novaryqLocationLink.groupBy({ by: ['restaurantId'], _count: { _all: true } }),
    prisma.novaryqItemLink.groupBy({ by: ['restaurantId'], _count: { _all: true } }),
    prisma.novaryqOrderSync.groupBy({ by: ['restaurantId'], where: { state: { in: ['PENDING', 'CANCEL_PENDING'] }, attempts: { gt: 1 } }, _count: { _all: true } }),
  ]);
  const per = (rows: Array<{ restaurantId: string; _count: { _all: number } }>, rid: string) => rows.find((r) => r.restaurantId === rid)?._count._all ?? 0;
  const HEALTH: Record<Health, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }> = {
    healthy: { label: 'healthy', variant: 'success' }, degraded: { label: 'needs attention', variant: 'warning' },
    failing: { label: 'failing', variant: 'destructive' }, off: { label: 'off', variant: 'muted' }, not_connected: { label: 'not connected', variant: 'muted' },
  };
  const count = (rid: string, state: string) => syncCounts.find((c) => c.restaurantId === rid && c.state === state)?._count._all ?? 0;
  const lastHook = (rid: string) => webhookLast.find((w) => w.restaurantId === rid)?._max.receivedAt ?? null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header className="space-y-1">
        <h1 className="display text-2xl sm:text-3xl font-semibold">Novaryq POS</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of every restaurant connected to Novaryq. Platform flag NOVARYQ_INTEGRATION_ENABLED is{' '}
          <Badge variant={novaryqFlagOn() ? 'success' : 'muted'}>{novaryqFlagOn() ? 'on' : 'off'}</Badge>
        </p>
      </header>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Restaurants</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Restaurant</th><th className="p-2">Health</th><th className="p-2">Connection</th><th className="p-2">Linked</th><th className="p-2">Sent</th>
                  <th className="p-2">Queued</th><th className="p-2">Failed</th><th className="p-2">Dead</th><th className="p-2">Last webhook</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {creds.map((c) => {
                  const summary = c.summary as { enabled?: boolean; menuMaster?: boolean } | null;
                  const enabled = summary?.enabled === true;
                  const health = HEALTH[computeHealth({
                    hasCred: true, connected: c.status === 'CONNECTED', enabled,
                    dead: count(c.restaurantId, 'DEAD'), failed: count(c.restaurantId, 'FAILED'), retrying: per(retryingRows, c.restaurantId),
                  })];
                  return (
                    <tr key={c.restaurantId}>
                      <td className="p-2">
                        {c.restaurant.name}
                        <div className="text-xs text-muted-foreground">/r/{c.restaurant.slug}{summary?.menuMaster ? ' · POS: Novaryq' : ''}</div>
                      </td>
                      <td className="p-2"><Badge variant={health.variant}>{health.label}</Badge></td>
                      <td className="p-2">
                        <Badge variant={c.status === 'CONNECTED' ? (enabled ? 'success' : 'muted') : 'destructive'}>
                          {c.status === 'CONNECTED' ? (enabled ? 'on' : 'paused') : c.status.toLowerCase()}
                        </Badge>
                        <div className="text-xs text-muted-foreground">tested {when(c.lastTestedAt)}</div>
                        {c.lastError && <div className="text-xs text-destructive break-words max-w-xs">{c.lastError}</div>}
                      </td>
                      <td className="p-2 text-xs whitespace-nowrap">{per(locationCounts, c.restaurantId)} branches · {per(itemCounts, c.restaurantId)} items</td>
                      <td className="p-2">{count(c.restaurantId, 'SENT')}</td>
                      <td className="p-2">{count(c.restaurantId, 'PENDING') + count(c.restaurantId, 'CANCEL_PENDING')}</td>
                      <td className="p-2">{count(c.restaurantId, 'FAILED')}</td>
                      <td className="p-2">{count(c.restaurantId, 'DEAD')}</td>
                      <td className="p-2 text-xs">{when(lastHook(c.restaurantId))}</td>
                    </tr>
                  );
                })}
                {creds.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No restaurant has connected Novaryq.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Failed and dead syncs (latest 50)</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Restaurant</th><th className="p-2">Order</th><th className="p-2">State</th><th className="p-2">Error</th><th className="p-2">Updated</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {problems.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2">{p.restaurant.name}</td>
                    <td className="p-2 whitespace-nowrap">{p.order.code}</td>
                    <td className="p-2"><Badge variant={p.state === 'DEAD' ? 'destructive' : 'warning'}>{p.state.toLowerCase()}</Badge> <span className="text-xs text-muted-foreground">{p.attempts} tries</span></td>
                    <td className="p-2 text-xs break-words max-w-sm">{p.lastError ?? ''}</td>
                    <td className="p-2 text-xs whitespace-nowrap">{when(p.updatedAt)}</td>
                  </tr>
                ))}
                {problems.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">None.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Replays are done by the restaurant admin under Admin → POS integration.</p>
        </CardContent>
      </Card>
    </div>
  );
}
