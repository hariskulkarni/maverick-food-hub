import Link from 'next/link';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { platformNovaryqConsole, type ConsoleRow, type ConsoleView, type IntegrationState } from '@/server/novaryq/platform';
import type { Health } from '@/server/novaryq/health';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Activity, AlertTriangle, PlugZap, Send, Store } from 'lucide-react';
import { HelpButton } from '@/components/help/help-button';

export const metadata = { title: 'Platform · Novaryq POS integration' };
export const dynamic = 'force-dynamic';

const when = (d: Date | null | undefined) =>
  d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';

const HEALTH: Record<Health, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }> = {
  healthy: { label: 'Healthy', variant: 'success' },
  degraded: { label: 'Needs attention', variant: 'warning' },
  failing: { label: 'Failing', variant: 'destructive' },
  off: { label: 'Off', variant: 'muted' },
  not_connected: { label: '—', variant: 'muted' },
};
const STATE: Record<IntegrationState, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }> = {
  on: { label: 'On', variant: 'success' },
  paused: { label: 'Paused', variant: 'muted' },
  test_failed: { label: 'Connection failed', variant: 'destructive' },
  not_set_up: { label: 'Not set up', variant: 'muted' },
};
const VIEWS: Array<{ key: ConsoleView; label: string }> = [
  { key: 'all', label: 'All restaurants' },
  { key: 'on', label: 'Integration on' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'not_set_up', label: 'Not set up' },
];

/**
 * Super-admin Novaryq console: enable and manage the Flavrly ↔ Novaryq POS integration for
 * any restaurant on the platform. "Set up" / "Manage" opens /platform/novaryq/[restaurantId],
 * which drives the same API as the restaurant's own admin page (audited, SUPER_ADMIN only).
 */
export default async function PlatformNovaryqPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : '';
  const view = (VIEWS.some((v) => v.key === sp.view) ? sp.view : 'all') as ConsoleView;
  const [c, problems] = await Promise.all([
    platformNovaryqConsole({ q, view }),
    prisma.novaryqOrderSync.findMany({
      where: { state: { in: ['FAILED', 'DEAD'] } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true, state: true, attempts: true, lastError: true, updatedAt: true, restaurantId: true, restaurant: { select: { name: true } }, order: { select: { code: true } } },
    }),
  ]);
  const href = (v: ConsoleView) => `/platform/novaryq?${new URLSearchParams({ ...(q ? { q } : {}), ...(v !== 'all' ? { view: v } : {}) })}`;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="display text-2xl sm:text-3xl font-semibold">Novaryq POS integration</h1>
          <HelpButton appArea="platform.novaryq" />
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Connect restaurants that run Novaryq India POS: Flavrly orders go to their Novaryq kitchen, kitchen progress and sold-out
          items come back. Set up and manage the integration for any restaurant here; restaurant admins see the same settings under
          Admin → POS integration.
        </p>
      </header>

      <Card className={c.flagOn ? '' : 'border-warning/50'}>
        <CardContent className="p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <PlugZap className={`size-6 shrink-0 ${c.flagOn ? 'text-success' : 'text-warning'}`} />
          <div className="flex-1 text-sm space-y-1">
            <div className="font-semibold">
              Platform switch <Badge variant={c.flagOn ? 'success' : 'warning'} className="ml-1">{c.flagOn ? 'ON' : 'OFF'}</Badge>
            </div>
            <p className="text-muted-foreground">
              {c.flagOn
                ? 'Restaurants whose integration is on sync orders, status and sold-out items with Novaryq.'
                : 'Nothing syncs while the switch is off — Flavrly and Novaryq run independently. Restaurants can be prepared once it is on.'}
              {' '}Switch: <code className="text-xs">NOVARYQ_INTEGRATION_ENABLED</code> in the server environment (deploy-level kill switch).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Store} label="Restaurants" value={c.kpis.restaurants} />
        <Kpi icon={Activity} label="Integration on" value={c.kpis.connected} />
        <Kpi icon={AlertTriangle} label="Needs attention" value={c.kpis.needsAttention} tone={c.kpis.needsAttention ? 'warning' : undefined} />
        <Kpi icon={Send} label="Orders sent (24 h)" value={c.kpis.sent24h} />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <Button key={v.key} asChild size="sm" variant={view === v.key ? 'default' : 'outline'}>
                  <Link href={href(v.key)}>{v.label}</Link>
                </Button>
              ))}
            </div>
            <form className="flex gap-2 lg:w-96" action="/platform/novaryq">
              {view !== 'all' && <input type="hidden" name="view" value={view} />}
              <Input name="q" defaultValue={q} placeholder="Search restaurant name or slug" aria-label="Search restaurants" />
              <Button type="submit" variant="outline">Search</Button>
            </form>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Restaurant</th>
                  <th className="p-2">Integration</th>
                  <th className="p-2">Health</th>
                  <th className="p-2">Linked</th>
                  <th className="p-2">Orders</th>
                  <th className="p-2">Last webhook</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.rows.map((r) => <Row key={r.id} r={r} />)}
                {c.rows.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No restaurants match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {c.truncated && <p className="text-xs text-muted-foreground">Showing the first {c.rows.length} of {c.total}. Search to narrow down.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Failed and dead syncs (latest 25)</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Restaurant</th><th className="p-2">Order</th><th className="p-2">State</th><th className="p-2">Error</th><th className="p-2">Updated</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {problems.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2"><Link href={`/platform/novaryq/${p.restaurantId}`} className="text-primary hover:underline">{p.restaurant.name}</Link></td>
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
          <p className="text-xs text-muted-foreground">Open a restaurant to replay its failed syncs.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Store; label: string; value: number; tone?: 'warning' }) {
  return (
    <Card className={tone === 'warning' ? 'border-warning/50 bg-warning/5' : ''}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ r }: { r: ConsoleRow }) {
  const st = STATE[r.state];
  const health = HEALTH[r.health];
  return (
    <tr className="align-top">
      <td className="p-2 min-w-48">
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-muted-foreground">{r.city ?? 'No branch'} · /r/{r.slug}{r.status !== 'ACTIVE' ? ` · ${r.status.toLowerCase()}` : ''}</div>
      </td>
      <td className="p-2 whitespace-nowrap">
        <Badge variant={st.variant}>{st.label}</Badge>
        {r.menuMaster && <div className="text-xs text-muted-foreground mt-1">POS: Novaryq</div>}
        {r.state === 'test_failed' && r.lastError && <div className="text-xs text-destructive mt-1 max-w-56 break-words">{r.lastError}</div>}
      </td>
      <td className="p-2"><Badge variant={health.variant}>{health.label}</Badge></td>
      <td className="p-2 text-xs whitespace-nowrap">
        {r.branchesLinked}/{r.branchesTotal} branches
        <div className="text-muted-foreground">{r.itemsLinked} items</div>
      </td>
      <td className="p-2 text-xs whitespace-nowrap">
        {r.sent} sent · {r.sent24h} today
        {(r.failed > 0 || r.dead > 0) && <div className="text-destructive">{r.failed} failed · {r.dead} dead</div>}
      </td>
      <td className="p-2 text-xs whitespace-nowrap">{when(r.lastWebhookAt)}</td>
      <td className="p-2 text-right">
        <Button asChild size="sm" variant={r.state === 'not_set_up' ? 'default' : 'outline'}>
          <Link href={`/platform/novaryq/${r.id}`}>{r.state === 'not_set_up' ? 'Set up' : 'Manage'}</Link>
        </Button>
      </td>
    </tr>
  );
}
