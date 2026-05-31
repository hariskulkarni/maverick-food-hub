'use client';
import { useEffect, useMemo, useState } from 'react';
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
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Search, X, RefreshCw, Check, Pause, Play, ArrowUpRight, Building2, MapPin, Users, Utensils, Wallet, Plug, Save, Loader2, AlertTriangle, ExternalLink, Network, Link2Off, Pencil, GripVertical, ArrowUpDown
} from 'lucide-react';

const STATUSES = ['ALL', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;

export function RestaurantsExplorer({ initial, cuisines, filters }: { initial: any[]; cuisines: string[]; filters: { status: string; q: string; cuisine: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [status, setStatus] = useState(filters.status || 'ALL');
  const [cuisine, setCuisine] = useState(filters.cuisine);
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Reorder mode ──────────────────────────────────────────────────────────
  // Drag-and-drop is gated behind an explicit toggle so an accidental drag
  // can't reshuffle the list. It's also disabled whenever the visible set
  // doesn't match the persisted set — reordering a filtered view would
  // assign sortOrder values without any notion of where filtered-out rows
  // belong, so we keep it strictly an "unfiltered, full-list" operation.
  const filtersActive = q.trim() !== '' || status !== 'ALL' || cuisine !== '';
  const [reorderMode, setReorderMode] = useState(false);
  // Local copy of the cards so we can render the new order immediately while
  // the save round-trips; on failure we revert to `initial`.
  const [order, setOrder] = useState<any[]>(initial);
  const [saving, setSaving] = useState(false);

  // Keep local order in sync when the server props change (refresh, filter).
  useEffect(() => { setOrder(initial); }, [initial]);

  // If the user activates a filter while in reorder mode, drop out of it —
  // mixing the two is the failure mode this UI is built to prevent.
  useEffect(() => { if (filtersActive && reorderMode) setReorderMode(false); }, [filtersActive, reorderMode]);

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

  // Pointer needs a small activation distance so plain clicks (Open button) on
  // the card don't get hijacked as drag starts. Keyboard sensor makes the
  // reorder accessible — Tab to a card, Space to grab, arrows to move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => order.map((r: { id: string }) => r.id), [order]);

  async function persistOrder(nextIds: string[]) {
    setSaving(true);
    try {
      const r = await fetch('/api/platform/restaurants/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: nextIds }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Outlet sequence saved');
    } catch (e: any) {
      toast.error('Could not save sequence', { description: String(e?.message ?? e).slice(0, 200) });
      // Revert to the server-truth order so the UI doesn't keep showing a
      // change that didn't stick.
      setOrder(initial);
    } finally {
      setSaving(false);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    persistOrder(next.map((r: { id: string }) => r.id));
  }

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, slug, or tagline" className="pl-9" disabled={reorderMode} />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
            </div>
            <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm min-w-[160px]" disabled={reorderMode}>
              <option value="">All cuisines</option>
              {cuisines.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button
              variant={reorderMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (reorderMode) {
                  setReorderMode(false);
                  return;
                }
                if (filtersActive) {
                  toast.info('Clear filters to reorder', { description: 'Reordering applies to the whole list, so it needs every outlet visible.' });
                  return;
                }
                setReorderMode(true);
              }}
              disabled={filtersActive && !reorderMode}
              className="ml-auto"
              title={filtersActive ? 'Clear filters to reorder' : 'Drag cards to reorder outlets'}
            >
              <ArrowUpDown className="size-4" /> {reorderMode ? 'Done' : 'Reorder'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.refresh()} disabled={reorderMode}><RefreshCw className="size-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => !reorderMode && setStatus(s)} disabled={reorderMode}>{s === 'ALL' ? 'All' : s}</Chip>
            ))}
            {reorderMode && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {saving ? <><Loader2 className="size-3 animate-spin" /> Saving sequence…</> : <>Drag cards to reorder · changes save automatically</>}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {reorderMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="grid gap-3 md:grid-cols-2">
              {order.map((r) => (
                <SortableRestaurantCard key={r.id} r={r} onOpen={() => setActiveId(r.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {initial.map((r) => <RestaurantCard key={r.id} r={r} onOpen={() => setActiveId(r.id)} />)}
          {initial.length === 0 && (
            <div className="md:col-span-2 rounded-xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">No restaurants match these filters.</div>
          )}
        </div>
      )}

      {activeId && <RestaurantDrawer id={activeId} onClose={() => setActiveId(null)} onChanged={() => router.refresh()} />}
    </>
  );
}

/**
 * Card variant rendered inside the SortableContext. The whole card is the
 * drag handle (with a visible grip cue) — easier than trying to isolate a
 * tiny handle on touch devices — but the "Open" button stops propagation so
 * a tap still opens the drawer.
 */
function SortableRestaurantCard({ r, onOpen }: { r: any; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`relative ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`} {...attributes} {...listeners}>
      <div className="absolute left-2 top-2 z-10 rounded-md bg-card/90 border p-1 text-muted-foreground pointer-events-none"><GripVertical className="size-3.5" /></div>
      <RestaurantCard r={r} onOpen={onOpen} />
    </div>
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
  const [eligibleParents, setEligibleParents] = useState<{ id: string; name: string }[]>([]);
  const [parentSel, setParentSel] = useState<string>('');
  const [savingParent, setSavingParent] = useState(false);
  // ── Identity (name / tagline / cuisine / slug) — super-admin-only edits.
  // The drawer mounts under /platform which already requires SUPER_ADMIN, so
  // the section is unconditionally rendered here (no client-side role gate
  // needed). The PATCH endpoint enforces SUPER_ADMIN server-side as well.
  const [ident, setIdent] = useState({ name: '', tagline: '', cuisine: '', slug: '' });
  const [identInit, setIdentInit] = useState({ name: '', tagline: '', cuisine: '', slug: '' });
  const [savingIdent, setSavingIdent] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/platform/restaurants/${id}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setData(j);
      setCommission(Number(j.restaurant.commissionPct ?? 15));
      setParentSel(j.restaurant.parentId ?? '');
      const seed = {
        name: j.restaurant.name ?? '',
        tagline: j.restaurant.tagline ?? '',
        cuisine: j.restaurant.cuisine ?? '',
        slug: j.restaurant.slug ?? '',
      };
      setIdent(seed);
      setIdentInit(seed);
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    fetch('/api/platform/restaurants/groups', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setEligibleParents(j.eligibleParents))
      .catch(() => {});
  }, []);

  async function saveParent(parentId: string | null) {
    setSavingParent(true);
    const r = await fetch(`/api/platform/restaurants/${id}/parent`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId }),
    });
    setSavingParent(false);
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    toast.success(parentId ? 'Assigned to parent' : 'Detached from group');
    load(); onChanged();
  }

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

  async function saveIdentity() {
    const payload: Record<string, string> = {};
    if (ident.name.trim() !== identInit.name) payload.name = ident.name.trim();
    if (ident.tagline.trim() !== identInit.tagline) payload.tagline = ident.tagline.trim();
    if (ident.cuisine.trim() !== identInit.cuisine) payload.cuisine = ident.cuisine.trim();
    if (ident.slug.trim().toLowerCase() !== identInit.slug) payload.slug = ident.slug.trim().toLowerCase();

    if (Object.keys(payload).length === 0) return;
    if (!ident.name.trim()) { toast.error('Name cannot be empty'); return; }

    // Slug changes break printed QR codes + any externally shared /r/<slug>
    // link, so require an explicit confirm before sending.
    if ('slug' in payload) {
      const ok = window.confirm(
        `Slug change will move the storefront from /r/${identInit.slug} to /r/${payload.slug}.\n\n` +
        `• Any printed QR codes pointing at the old URL will stop working.\n` +
        `• Any external links / bookmarks to the old URL will 404.\n\n` +
        `Continue?`,
      );
      if (!ok) return;
    }

    setSavingIdent(true);
    const r = await fetch(`/api/platform/restaurants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSavingIdent(false);
    if (!r.ok) {
      const msg = await r.text();
      let pretty = msg;
      try { pretty = JSON.parse(msg).error ?? msg; } catch {}
      return toast.error('Save failed', { description: pretty.slice(0, 200) });
    }
    toast.success('Restaurant details updated');
    load();
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
      {/* Identity — super-admin-only edits for name / tagline / cuisine / slug. */}
      <DrawerSection title="Restaurant identity" action={<Pencil className="size-3.5 text-muted-foreground" />}>
        <div className="p-4 space-y-3">
          <label className="block text-xs font-medium">
            <span className="text-muted-foreground">Outlet name</span>
            <input
              type="text"
              value={ident.name}
              onChange={(e) => setIdent((s) => ({ ...s, name: e.target.value }))}
              maxLength={120}
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:border-primary"
              placeholder="Combo Nation"
            />
          </label>
          <label className="block text-xs font-medium">
            <span className="text-muted-foreground">Tagline</span>
            <input
              type="text"
              value={ident.tagline}
              onChange={(e) => setIdent((s) => ({ ...s, tagline: e.target.value }))}
              maxLength={240}
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:border-primary"
              placeholder="Where every meal becomes a feast"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              <span className="text-muted-foreground">Cuisine</span>
              <input
                type="text"
                value={ident.cuisine}
                onChange={(e) => setIdent((s) => ({ ...s, cuisine: e.target.value }))}
                maxLength={60}
                className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:border-primary"
                placeholder="Indian"
              />
            </label>
            <label className="block text-xs font-medium">
              <span className="text-muted-foreground">Slug</span>
              <input
                type="text"
                value={ident.slug}
                onChange={(e) => setIdent((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                maxLength={64}
                className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm font-mono focus:outline-none focus:border-primary"
                placeholder="combo-nation"
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Public URL: <span className="font-mono">/r/{ident.slug || '…'}</span>
              </span>
            </label>
          </div>

          {ident.slug !== identInit.slug && (
            <div className="rounded-md bg-warning/5 border border-warning/30 p-2 text-[11px] text-warning-foreground flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-warning" />
              <span>
                Changing the slug breaks any printed QR codes + saved links pointing at
                <code className="mx-1 rounded bg-card px-1 py-0.5 font-mono">/r/{identInit.slug}</code>.
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              disabled={savingIdent || (
                ident.name.trim() === identInit.name &&
                ident.tagline.trim() === identInit.tagline &&
                ident.cuisine.trim() === identInit.cuisine &&
                ident.slug.trim() === identInit.slug
              ) || !ident.name.trim()}
              onClick={saveIdentity}
            >
              {savingIdent ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {savingIdent ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={savingIdent}
              onClick={() => setIdent(identInit)}
            >
              Reset
            </Button>
          </div>
        </div>
      </DrawerSection>

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

      <DrawerSection title="Group / parent" action={r.children.length > 0 ? <Badge>Parent · {r.children.length}</Badge> : r.parent ? <Badge variant="muted">Child</Badge> : <Badge variant="muted">Standalone</Badge>}>
        <div className="p-4 space-y-3 text-sm">
          {r.children.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-muted-foreground"><Network className="size-4" /> Heads a group of {r.children.length} restaurant{r.children.length === 1 ? '' : 's'}.</div>
              <ul className="rounded-md border divide-y">
                {r.children.map((c: any) => (
                  <li key={c.id} className="flex items-center justify-between px-3 py-2">
                    <span>{c.name}</span><StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Detach all children before this restaurant can become a child of another.</p>
            </>
          ) : r.parent ? (
            <>
              <div className="flex items-center gap-2"><Network className="size-4 text-primary" /> Child of <strong>{r.parent.name}</strong></div>
              <div className="flex flex-wrap gap-2">
                <select value={parentSel} onChange={(e) => setParentSel(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm flex-1 w-full min-w-0 sm:min-w-[180px]">
                  {eligibleParents.filter((p) => p.id !== r.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Button size="sm" disabled={savingParent || parentSel === r.parentId} onClick={() => saveParent(parentSel || null)}><Save className="size-3.5" /> Move</Button>
                <Button size="sm" variant="outline" disabled={savingParent} onClick={() => saveParent(null)}><Link2Off className="size-3.5" /> Detach</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Standalone restaurant. Assign it under a top-level parent to operate it as part of a group.</p>
              <div className="flex flex-wrap gap-2">
                <select value={parentSel} onChange={(e) => setParentSel(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm flex-1 w-full min-w-0 sm:min-w-[180px]">
                  <option value="">Select a parent…</option>
                  {eligibleParents.filter((p) => p.id !== r.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Button size="sm" disabled={savingParent || !parentSel} onClick={() => saveParent(parentSel)}><Network className="size-3.5" /> Assign</Button>
              </div>
            </>
          )}
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
function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>{children}</button>;
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
