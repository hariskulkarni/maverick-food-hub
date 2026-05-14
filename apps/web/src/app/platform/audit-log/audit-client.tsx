'use client';
/**
 * Super-admin audit log viewer.
 *
 *   – filter bar: search, action chips, entity-type select, date range
 *   – sortable table: time | actor | action | entity | ip
 *   – click row → DetailDrawer with before/after JSON side-by-side
 *   – CSV export of currently-loaded rows
 *
 * Data is fetched server-side (page.tsx) on initial load and via URL push
 * when filters change. We keep ≤200 rows on screen — large investigations
 * should narrow the filters or hit the API directly.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { Search, Download, RefreshCw, X, ArrowUpRight, ArrowUpDown } from 'lucide-react';
import { fmtDate } from '@/lib/utils';

type Role = 'CUSTOMER' | 'ADMIN' | 'KITCHEN' | 'RIDER' | 'SUPER_ADMIN';

type Row = {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  restaurantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: any;
  after: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string | null; phone: string | null; role: Role } | null;
};

type Filters = { actorId: string; action: string; entityType: string; from: string; to: string; q: string };
type Facets = { actions: string[]; entityTypes: string[] };

const QUICK_ACTIONS = [
  'restaurant.approve', 'restaurant.suspend',
  'rider.approve', 'rider.suspend',
  'order.cancel', 'order.refund',
  'coupon.create', 'coupon.update', 'coupon.delete',
  'wallet.credit', 'wallet.debit',
  'menu.price.change'
];

export function AuditClient({ initial, filters, facets }: { initial: Row[]; filters: Filters; facets: Facets }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ]                 = useState(filters.q);
  const [actorId, setActorId]     = useState(filters.actorId);
  const [action, setAction]       = useState(filters.action);
  const [entityType, setEntityType] = useState(filters.entityType);
  const [from, setFrom]           = useState(filters.from);
  const [to, setTo]               = useState(filters.to);
  const [sort, setSort]           = useState<'time-desc' | 'time-asc'>('time-desc');
  const [activeId, setActiveId]   = useState<string | null>(null);

  // Push filters → URL (debounced) so the server page re-fetches.
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      sp.delete('q'); sp.delete('actorId'); sp.delete('action'); sp.delete('entityType'); sp.delete('from'); sp.delete('to');
      if (q.trim())        sp.set('q', q.trim());
      if (actorId.trim())  sp.set('actorId', actorId.trim());
      if (action)          sp.set('action', action);
      if (entityType)      sp.set('entityType', entityType);
      if (from)            sp.set('from', from);
      if (to)              sp.set('to', to);
      router.replace(`/platform/audit-log?${sp.toString()}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, actorId, action, entityType, from, to]);

  const sorted = useMemo(() => {
    const r = [...initial];
    r.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sort === 'time-desc' ? tb - ta : ta - tb;
    });
    return r;
  }, [initial, sort]);

  const activeRow = activeId ? initial.find((r) => r.id === activeId) ?? null : null;

  const allActions = useMemo(() => {
    const set = new Set<string>([...QUICK_ACTIONS, ...facets.actions]);
    return Array.from(set);
  }, [facets.actions]);

  function clearFilters() {
    setQ(''); setActorId(''); setAction(''); setEntityType(''); setFrom(''); setTo('');
  }

  function exportCsv() {
    const head = ['Time', 'Actor ID', 'Actor name', 'Actor role', 'Action', 'Entity type', 'Entity ID', 'IP', 'User agent'];
    const rows = sorted.map((r) => [
      new Date(r.createdAt).toISOString(),
      r.actorId ?? '',
      r.actor?.name ?? r.actor?.email ?? r.actor?.phone ?? '',
      r.actorRole ?? r.actor?.role ?? '',
      r.action,
      r.entityType,
      r.entityId ?? '',
      r.ipAddress ?? '',
      r.userAgent ?? ''
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const hasFilters = !!(q || actorId || action || entityType || from || to);

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, entity ID, or IP" className="pl-9" />
              {q && (
                <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="Actor ID" className="w-44" />
            <Select value={entityType || '__all'} onValueChange={(v) => setEntityType(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Any entity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any entity</SelectItem>
                {facets.entityTypes.map((et) => <SelectItem key={et} value={et}>{et}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <div className="ml-auto flex gap-2">
              {hasFilters && <Button variant="outline" size="sm" onClick={clearFilters}><X className="size-4" /> Clear</Button>}
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => router.refresh()}><RefreshCw className="size-4" /> Refresh</Button>
            </div>
          </div>
          {/* Action chips */}
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!action} onClick={() => setAction('')}>All actions</Chip>
            {allActions.map((a) => (
              <Chip key={a} active={action === a} onClick={() => setAction(action === a ? '' : a)}>
                {a}
              </Chip>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">{sorted.length} {sorted.length === 1 ? 'event' : 'events'}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>
                    <button onClick={() => setSort((s) => s === 'time-desc' ? 'time-asc' : 'time-desc')} className="inline-flex items-center gap-1 hover:text-foreground">
                      Time <ArrowUpDown className="size-3" />
                    </button>
                  </Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>IP</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.length === 0 && (
                  <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No audit events match these filters.</td></tr>
                )}
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(r.id)}>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      <div>{fmtDate(r.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                      <div className="text-muted-foreground text-[10px]">{new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.actor ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div>
                            <div className="font-medium truncate max-w-[180px]">{r.actor.name || r.actor.email || r.actor.phone || '—'}</div>
                            <div className="text-[10px] text-muted-foreground">{r.actor.id.slice(0, 10)}…</div>
                          </div>
                          <RoleBadge role={(r.actorRole as Role) ?? r.actor.role} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">System</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><code className="text-xs font-mono">{r.action}</code></td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{r.entityType}</div>
                      {r.entityId && <div className="text-muted-foreground font-mono">{r.entityId.slice(0, 16)}…</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{r.ipAddress || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveId(r.id); }}>
                        Details <ArrowUpRight className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeRow && (
        <DetailDrawer
          open
          onOpenChange={(v) => !v && setActiveId(null)}
          title={<code className="text-sm font-mono">{activeRow.action}</code>}
          subtitle={`${activeRow.entityType}${activeRow.entityId ? ` · ${activeRow.entityId.slice(0, 24)}` : ''}`}
          badge={activeRow.actorRole && <RoleBadge role={activeRow.actorRole as Role} />}
          width="900px"
        >
          <DrawerSection title="Context">
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              <Cell label="Time"     value={new Date(activeRow.createdAt).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'long' })} />
              <Cell label="Actor"    value={activeRow.actor?.name || activeRow.actor?.email || activeRow.actor?.phone || activeRow.actorId || 'System'} />
              <Cell label="Actor ID" value={activeRow.actorId ?? '—'} mono />
              <Cell label="Entity"   value={`${activeRow.entityType}${activeRow.entityId ? ` · ${activeRow.entityId}` : ''}`} mono />
              <Cell label="IP"       value={activeRow.ipAddress ?? '—'} mono />
              <Cell label="Restaurant" value={activeRow.restaurantId ?? '—'} mono />
            </div>
            {activeRow.userAgent && (
              <div className="border-t p-4 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">User agent</div>
                <div className="font-mono text-[11px] break-all">{activeRow.userAgent}</div>
              </div>
            )}
          </DrawerSection>

          <DrawerSection title="Before / after">
            <div className="grid grid-cols-2 divide-x">
              <div className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Before</div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[420px] overflow-y-auto rounded bg-muted/40 p-2">
                  {activeRow.before ? JSON.stringify(activeRow.before, null, 2) : '(empty)'}
                </pre>
              </div>
              <div className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">After</div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[420px] overflow-y-auto rounded bg-muted/40 p-2">
                  {activeRow.after ? JSON.stringify(activeRow.after, null, 2) : '(empty)'}
                </pre>
              </div>
            </div>
          </DrawerSection>
        </DetailDrawer>
      )}
    </>
  );
}

// ─── small bits ─────────────────────────────────────────────────────────────
function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function Cell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-xs' : 'text-sm'} break-all`}>{value}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role | string }) {
  const map: Record<string, { cls: string; label: string }> = {
    SUPER_ADMIN: { cls: 'bg-destructive/10 text-destructive border-destructive/30', label: 'Super admin' },
    ADMIN:       { cls: 'bg-primary/10 text-primary border-primary/30',             label: 'Admin' },
    KITCHEN:     { cls: 'bg-warning/10 text-warning border-warning/30',             label: 'Kitchen' },
    RIDER:       { cls: 'bg-success/10 text-success border-success/30',             label: 'Rider' },
    CUSTOMER:    { cls: 'bg-muted text-muted-foreground',                           label: 'Customer' }
  };
  const m = map[role as string] ?? { cls: 'bg-muted text-muted-foreground', label: String(role) };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}
