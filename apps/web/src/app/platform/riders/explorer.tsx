'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { toast } from 'sonner';
import { Search, X, Bike, Phone, Star, Wallet, Plus, Minus, Save, Loader2, MapPin } from 'lucide-react';
import { PayoutOverridePanel } from './payout-override-panel';

interface RiderRow {
  id: string;
  user: { id: string; name: string | null; phone: string | null };
  branch?: { name: string } | null;
  vehicleType: string;
  vehicleNumber: string | null;
  isOnline: boolean;
  currentLat: number | null;
  currentLng: number | null;
  currentLoad: number;
  rating: number;
  totalDeliveries: number;
  totalEarnings: any;
  totalTips: any;
  approvedAt: string | null;
}

const FILTERS = ['ALL', 'ONLINE', 'OFFLINE', 'UNAPPROVED'] as const;

export function RidersExplorer({ initial }: { initial: RiderRow[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<typeof FILTERS[number]>('ALL');
  const [vehicle, setVehicle] = useState<string>('ALL');
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return initial.filter((r) => {
      if (filter === 'ONLINE' && !r.isOnline) return false;
      if (filter === 'OFFLINE' && r.isOnline) return false;
      if (filter === 'UNAPPROVED' && r.approvedAt) return false;
      if (vehicle !== 'ALL' && r.vehicleType !== vehicle) return false;
      if (ql) {
        const hay = `${r.user.name ?? ''} ${r.user.phone ?? ''} ${r.vehicleNumber ?? ''}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [initial, q, filter, vehicle]);

  const vehicles = Array.from(new Set(initial.map((r) => r.vehicleType))).sort();

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, or plate" className="pl-9" />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
            </div>
            <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm">
              <option value="ALL">All vehicles</option>
              {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <div className="flex items-center gap-1 ml-auto">
              {FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{prettyFilter(f)}</Chip>)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length} rider{filtered.length === 1 ? '' : 's'} match</div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((r) => <RiderCard key={r.id} r={r} onOpen={() => setActiveId(r.id)} />)}
        {filtered.length === 0 && (
          <div className="md:col-span-2 rounded-xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">No riders match these filters.</div>
        )}
      </div>

      {activeId && <RiderDrawer id={activeId} onClose={() => setActiveId(null)} />}
    </>
  );
}

function RiderCard({ r, onOpen }: { r: RiderRow; onOpen: () => void }) {
  return (
    <Card className="card-lift cursor-pointer" onClick={onOpen}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`grid size-10 place-items-center rounded-full shrink-0 ${r.isOnline ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
              <Bike className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{r.user.name ?? r.user.phone}</div>
              <div className="text-xs text-muted-foreground font-mono">{r.user.phone}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{r.vehicleType} · {r.vehicleNumber ?? '—'}</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <Badge variant={r.isOnline ? 'success' : 'muted'} className="text-[10px]">{r.isOnline ? 'Online' : 'Offline'}</Badge>
            {!r.approvedAt && <Badge variant="warning" className="text-[10px] mt-1 block">Unapproved</Badge>}
          </div>
        </div>
        {/* 4 mini-stats. At 360px four equal cells (~80px each) compress the
            ₹-prefixed Earnings number. Stack 2-up on phones, 4-up on sm+. */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <Mini label="Active"    value={String(r.currentLoad)} />
          <Mini label="Rating"    value={`⭐ ${Number(r.rating ?? 0).toFixed(1)}`} />
          <Mini label="Trips"     value={String(r.totalDeliveries)} />
          <Mini label="Earnings"  value={`₹${Number(r.totalEarnings).toLocaleString('en-IN')}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function RiderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bonusAmount, setBonusAmount] = useState<number>(0);
  const [bonusNote, setBonusNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/platform/riders/${id}`, { cache: 'no-store' });
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function applyBonus(sign: 1 | -1) {
    if (!bonusAmount || bonusAmount <= 0) return;
    setBusy(true);
    const r = await fetch(`/api/platform/riders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ earningsBonus: sign * bonusAmount, bonusReason: bonusNote || (sign === 1 ? 'Admin bonus' : 'Admin penalty') })
    });
    setBusy(false);
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    toast.success(`${sign === 1 ? 'Credited' : 'Debited'} ₹${bonusAmount}`);
    setBonusAmount(0); setBonusNote('');
    load();
  }

  async function approve() {
    setBusy(true);
    const r = await fetch(`/api/platform/riders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: true }) });
    setBusy(false);
    if (!r.ok) return toast.error('Failed');
    toast.success('Rider approved');
    load();
  }

  if (loading || !data) {
    return (
      <DetailDrawer open onOpenChange={(v) => !v && onClose()} title="Loading…">
        <div className="grid place-items-center h-40"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      </DetailDrawer>
    );
  }
  const p = data.profile;

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={p.user.name ?? p.user.phone}
      subtitle={`${p.vehicleType} ${p.vehicleNumber ?? ''} · Home base: ${p.branch?.name ?? '—'}`}
      badge={
        <div className="flex gap-1.5">
          <Badge variant={p.isOnline ? 'success' : 'muted'} className="text-[10px]">{p.isOnline ? 'Online' : 'Offline'}</Badge>
          {!p.approvedAt && <Badge variant="warning" className="text-[10px]">Unapproved</Badge>}
        </div>
      }
      width="640px"
    >
      <DrawerSection title="Contact">
        <div className="p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /> <span className="font-mono">{p.user.phone}</span></div>
          {p.currentLat != null && p.currentLng != null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> Last known location: {p.currentLat.toFixed(4)}, {p.currentLng.toFixed(4)}
              <a href={`https://www.google.com/maps/search/?api=1&query=${p.currentLat},${p.currentLng}`} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1">Map</a>
            </div>
          )}
        </div>
      </DrawerSection>

      {!p.approvedAt && (
        <DrawerSection title="Approval">
          <div className="p-4 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">This rider hasn't been approved yet. They cannot claim orders until you approve.</span>
            <Button size="sm" onClick={approve} disabled={busy}>Approve</Button>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="Lifetime">
        {/* 4 lifetime stats inside a side drawer. divide-x produces vertical
            dividers; on phone the drawer is ~360px so 4-up gives ~85px per
            cell, ₹-prefixed Earnings/Tips numbers clip. Stack 2-up on phones,
            4-up on sm+. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x text-center">
          <Cell label="Trips"     value={String(p.totalDeliveries)} />
          <Cell label="Rating"    value={`⭐ ${Number(p.rating ?? 0).toFixed(1)}`} />
          <Cell label="Earnings"  value={`₹${Number(p.totalEarnings).toLocaleString('en-IN')}`} />
          <Cell label="Tips"      value={`₹${Number(p.totalTips).toLocaleString('en-IN')}`} />
        </div>
      </DrawerSection>

      <DrawerSection title="30-day earnings breakdown">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x text-center">
          <Cell label="Trips" value={String(data.earnings30d._count ?? 0)} />
          <Cell label="Base"  value={`₹${Number(data.earnings30d._sum.baseEarningsAmt ?? 0).toLocaleString('en-IN')}`} />
          <Cell label="Bonus" value={`₹${Number(data.earnings30d._sum.bonusAmt ?? 0).toLocaleString('en-IN')}`} />
          <Cell label="Tips"  value={`₹${Number(data.earnings30d._sum.tipAmt ?? 0).toLocaleString('en-IN')}`} />
        </div>
      </DrawerSection>

      <DrawerSection title="Payout rule">
        <div className="p-4">
          <PayoutOverridePanel riderId={id} />
        </div>
      </DrawerSection>

      <DrawerSection title="Manual earnings adjustment">
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">Credit or debit the rider's lifetime earnings. Audited automatically.</p>
          <div className="flex gap-2">
            <Input type="number" min={1} step={1} value={bonusAmount || ''} onChange={(e) => setBonusAmount(Number(e.target.value) || 0)} placeholder="Amount ₹" className="w-32 h-9" />
            <Input value={bonusNote} onChange={(e) => setBonusNote(e.target.value)} placeholder="Reason" className="flex-1 h-9" />
            <Button size="sm" variant="outline" disabled={!bonusAmount || busy} onClick={() => applyBonus(1)} className="text-success border-success/40 hover:bg-success/10"><Plus className="size-3.5" /> Credit</Button>
            <Button size="sm" variant="outline" disabled={!bonusAmount || busy} onClick={() => applyBonus(-1)} className="text-destructive border-destructive/40 hover:bg-destructive/10"><Minus className="size-3.5" /> Debit</Button>
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title={`Recent assignments (${data.recent.length})`}>
        <ul className="divide-y text-sm">
          {data.recent.slice(0, 12).map((a: any) => (
            <li key={a.id} className="p-3 flex items-center gap-3">
              <div className="font-mono text-xs">{a.order.code}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs truncate">{a.order.branch.restaurant.name}</div>
                <div className="text-[10px] text-muted-foreground">{new Date(a.assignedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })} · ₹{Number(a.earningsAmt).toLocaleString('en-IN')}{Number(a.tipAmt) > 0 ? ` + ₹${Number(a.tipAmt)} tip` : ''}</div>
              </div>
              <Badge variant="muted" className="text-[10px]">{a.status}</Badge>
            </li>
          ))}
          {data.recent.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">No deliveries yet.</li>}
        </ul>
      </DrawerSection>

      {data.ratingHistory.length > 0 && (
        <DrawerSection title="Recent ratings">
          <ul className="divide-y text-sm">
            {data.ratingHistory.map((rh: any, i: number) => (
              <li key={i} className="p-3 flex items-start gap-3">
                <div className="grid size-8 place-items-center rounded-lg bg-warning/10 text-warning shrink-0"><Star className="size-4 fill-current" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">⭐ {rh.customerRating}/5</div>
                  {rh.customerComment && <div className="text-xs text-muted-foreground italic">"{rh.customerComment}"</div>}
                  <div className="text-[10px] text-muted-foreground">{new Date(rh.deliveredAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
                </div>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

// helpers
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>{children}</button>;
}
function Cell({ label, value }: { label: string; value: string }) {
  return <div className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="font-bold mt-0.5">{value}</div></div>;
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-card p-2"><div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div><div className="font-medium truncate">{value}</div></div>;
}
function prettyFilter(f: string) {
  return ({ ALL: 'All', ONLINE: 'Online', OFFLINE: 'Offline', UNAPPROVED: 'Unapproved' } as Record<string, string>)[f];
}
