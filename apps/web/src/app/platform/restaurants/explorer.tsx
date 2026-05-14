'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { QrCard } from '@/components/qr-card';
import { toast } from 'sonner';
import {
  Search, X, RefreshCw, Check, Pause, Play, ArrowUpRight, Building2, MapPin, Users, Utensils, Wallet, Plug, Save, Loader2, AlertTriangle, ExternalLink
} from 'lucide-react';

const STATUSES = ['ALL', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;

export function RestaurantsExplorer({ initial, cuisines, filters }: { initial: any[]; cuisines: string[]; filters: { status: string; q: string; cuisine: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [status, setStatus] = useState(filters.status || 'ALL');
  const [cuisine, setCuisine] = useState(filters.cuisine);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      ['q', 'status', 'cuisine'].forEach((k) => sp.delete(k));
      if (q.trim()) sp.set('q', q.trim());
      if (status !== 'ALL') sp.set('status', status);
      if (cuisine) sp.set('cuisine', cuisine);
      router.replace(`/platform/restaurants?${sp.toString()}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, cuisine]);

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, slug, or tagline" className="pl-9" />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
            </div>
            <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm min-w-[160px]">
              <option value="">All cuisines</option>
              {cuisines.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => router.refresh()} className="ml-auto"><RefreshCw className="size-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{s === 'ALL' ? 'All' : s}</Chip>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {initial.map((r) => <RestaurantCard key={r.id} r={r} onOpen={() => setActiveId(r.id)} />)}
        {initial.length === 0 && (
          <div className="md:col-span-2 rounded-xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">No restaurants match these filters.</div>
        )}
      </div>

      {activeId && <RestaurantDrawer id={activeId} onClose={() => setActiveId(null)} onChanged={() => router.refresh()} />}
    </>
  );
}

function RestaurantCard({ r, onOpen }: { r: any; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden card-lift">
      <CardContent className="p-0">
        <div className="relative h-24 bg-muted">
          {r.coverImageUrl
            ? <Image src={r.coverImageUrl} alt="" fill sizes="600px" className="object-cover" />
            : <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-warning/10 to-success/10" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          {r.logoUrl && (
            <div className="absolute -bottom-5 left-4 size-12 rounded-xl overflow-hidden border-2 border-card bg-card">
              <Image src={r.logoUrl} alt="" fill sizes="48px" className="object-cover" />
            </div>
          )}
          <div className="absolute top-3 right-3"><StatusBadge status={r.status} /></div>
        </div>
        <div className={`p-4 ${r.logoUrl ? 'pt-7' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate">{r.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{r._count.branches} branch{r._count.branches === 1 ? '' : 'es'} · {r.cuisine ?? 'No cuisine set'}</div>
            </div>
            <Button size="sm" variant="outline" onClick={onOpen}>Open <ArrowUpRight className="size-3.5" /></Button>
          </div>
          {r.tagline && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{r.tagline}</p>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <Mini label="Owner"      value={r.owner?.name || r.owner?.email || '—'} />
            <Mini label="Commission" value={`${r.commissionPct}%`} />
            <Mini label="Joined"     value={new Date(r.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RestaurantDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [commission, setCommission] = useState(15);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/platform/restaurants/${id}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setData(j);
      setCommission(Number(j.restaurant.commissionPct ?? 15));
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function lifecycle(action: 'approve' | 'reject' | 'suspend', body?: any) {
    const r = await fetch(`/api/platform/restaurants/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    toast.success('Done');
    load(); onChanged();
  }
  async function saveCommission() {
    setSaving(true);
    const r = await fetch(`/api/platform/restaurants/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commissionPct: commission }) });
    setSaving(false);
    if (!r.ok) return toast.error('Save failed');
    toast.success(`Commission set to ${commission}%`);
    onChanged();
  }

  if (loading || !data) {
    return (
      <DetailDrawer open onOpenChange={(v) => !v && onClose()} title="Loading…">
        <div className="grid place-items-center h-40"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      </DetailDrawer>
    );
  }
  const r = data.restaurant;

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={r.name}
      subtitle={r.tagline ?? `${r.cuisine ?? 'No cuisine'} · /r/${r.slug}`}
      badge={<StatusBadge status={r.status} />}
      width="680px"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/r/${r.slug}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="size-3.5" /> Preview public page</a>
        </div>
      }
    >
      {/* Lifecycle actions */}
      <DrawerSection title="Lifecycle">
        <div className="p-4 flex flex-wrap gap-2">
          {r.status === 'PENDING' && (
            <>
              <Button size="sm" onClick={() => lifecycle('approve')}><Check className="size-4" /> Approve</Button>
              <Button size="sm" variant="outline" onClick={() => { const reason = prompt('Reason for rejection?'); if (reason) lifecycle('reject', { reason }); }}><X className="size-4" /> Reject</Button>
            </>
          )}
          {r.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => lifecycle('suspend')}><Pause className="size-4" /> Suspend</Button>
          )}
          {r.status === 'SUSPENDED' && (
            <Button size="sm" onClick={() => lifecycle('approve')}><Play className="size-4" /> Reactivate</Button>
          )}
          {r.status === 'REJECTED' && r.rejectedReason && (
            <div className="text-xs text-destructive flex items-center gap-2"><AlertTriangle className="size-3.5" /> Rejected: {r.rejectedReason}</div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Storefront URL">
        <div className="p-4">
          {r.status === 'ACTIVE' ? (
            <div className="max-w-xs">
              <QrCard
                url={`${typeof window !== 'undefined' ? window.location.origin : ''}/r/${r.slug}`}
                label="Customer-facing"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
              URL will be generated on approval.
            </div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="30-day metrics">
        <div className="grid grid-cols-3 divide-x">
          <Cell label="Orders" value={data.metrics30d.orders.toLocaleString('en-IN')} />
          <Cell label="GMV"    value={`₹${Number(data.metrics30d.gmv).toLocaleString('en-IN')}`} />
          <Cell label="Top dishes" value={String(data.topItems.length)} />
        </div>
      </DrawerSection>

      <DrawerSection title="Commission" action={<Badge>{commission}%</Badge>}>
        <div className="p-4 space-y-3">
          <input type="range" min={0} max={30} step={0.5} value={commission} onChange={(e) => setCommission(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>0%</span><span>30%</span></div>
          <p className="text-xs text-muted-foreground">Platform's cut on every paid order. Default is 15%.</p>
          <Button size="sm" disabled={saving || commission === Number(r.commissionPct)} onClick={saveCommission}>
            <Save className="size-3.5" /> {saving ? 'Saving…' : 'Save commission'}
          </Button>
        </div>
      </DrawerSection>

      <DrawerSection title="Owner & team">
        <div className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><strong>{r.owner.name}</strong> · <span className="text-muted-foreground">{r.owner.email}</span></div>
          {r.members.length > 0 && (
            <div className="text-xs text-muted-foreground">{r.members.length} member{r.members.length === 1 ? '' : 's'}: {r.members.map((m: any) => `${m.user.name ?? m.user.email} (${m.user.role})`).join(', ')}</div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title={`Branches (${r.branches.length})`}>
        <ul className="divide-y text-sm">
          {r.branches.map((b: any) => (
            <li key={b.id} className="p-3 flex items-start gap-3">
              <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{b.line1}, {b.city} {b.postalCode}</div>
                <div className="text-[10px] text-muted-foreground">Service radius {b.serviceRadiusKm}km · Tax {b.taxRatePct}% · {b.isActive ? 'Active' : 'Paused'}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">
                <div>{b._count.menuItems} dishes</div>
                <div>{b._count.orders} orders</div>
              </div>
            </li>
          ))}
        </ul>
      </DrawerSection>

      {data.topItems.length > 0 && (
        <DrawerSection title="Top dishes (30d)">
          <ul className="divide-y text-sm">
            {data.topItems.map((it: any, i: number) => (
              <li key={it.id} className="p-3 flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary text-xs font-bold">{i + 1}</span>
                <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                  {it.imageUrl && <Image src={it.imageUrl} alt="" fill sizes="40px" className="object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{it.name}</div>
                  <div className="text-[11px] text-muted-foreground">{it.soldQty} sold · ₹{it.price}</div>
                </div>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}

      {r.integrations.length > 0 && (
        <DrawerSection title={`Integrations (${r.integrations.length})`}>
          <ul className="divide-y text-sm">
            {r.integrations.map((i: any) => (
              <li key={i.provider} className="p-3 flex items-center gap-3">
                <div className={`grid size-8 place-items-center rounded-lg shrink-0 ${i.status === 'CONNECTED' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                  <Plug className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs">{i.provider.replace('_', ' ')}</div>
                  <div className="text-[10px] text-muted-foreground">{i.lastTestedAt ? `Last tested ${new Date(i.lastTestedAt).toLocaleString('en-IN')}` : 'Never tested'}</div>
                </div>
                <Badge variant={i.status === 'CONNECTED' ? 'success' : 'muted'} className="text-[10px]">{i.status}</Badge>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>{children}</button>;
}
function Cell({ label, value }: { label: string; value: string }) {
  return <div className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="font-bold mt-0.5">{value}</div></div>;
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-card p-2"><div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div><div className="font-medium truncate">{value}</div></div>;
}
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:   'bg-warning/15 text-warning border-warning/30',
    ACTIVE:    'bg-success/15 text-success border-success/30',
    SUSPENDED: 'bg-destructive/15 text-destructive border-destructive/30',
    REJECTED:  'bg-muted text-muted-foreground'
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status] ?? 'bg-muted'}`}>{status}</span>;
}
