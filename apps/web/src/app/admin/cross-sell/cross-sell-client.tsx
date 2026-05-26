'use client';
/**
 * Cross-sell management surface.
 *
 *   <CrossSellClient />
 *     – `Add cross-sell` button reveals an inline composer row
 *     – list of cross-sells grouped by parent item, each row shows the
 *       suggested item + the surfaces (pdp / cart) + a remove button +
 *       editable sort order
 *     – clear empty state with a "Get started" CTA
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, Layers, Trash2, X, Search } from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';

type CrossSell = {
  id: string;
  parentItemId: string;
  suggestedItemId: string;
  sortOrder: number;
  surface: string;         // 'pdp', 'cart', or 'pdp,cart'
  kind?: string;           // 'frequently_together' | 'complete_meal' | 'add_drink' | 'add_dessert' | 'add_side'
  note: string | null;
  source: string;
  isActive: boolean;
  createdAt: string;
};

type Kind = 'frequently_together' | 'complete_meal' | 'add_drink' | 'add_dessert' | 'add_side';
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'frequently_together', label: 'Frequently ordered together' },
  { value: 'complete_meal',       label: 'Complete your meal' },
  { value: 'add_drink',           label: 'Add a drink' },
  { value: 'add_dessert',         label: 'Add a dessert' },
  { value: 'add_side',            label: 'Add a side' }
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label]));

type MenuItem = {
  id: string;
  name: string;
  branchId: string;
  categoryId: string;
  price: string | number;
  isAvailable: boolean;
};

type Branch = { id: string; name: string; isActive: boolean };

type Surface = 'pdp' | 'cart';
const SURFACE_OPTIONS: Surface[] = ['pdp', 'cart'];

export function CrossSellClient({
  crossSells, menuItems, branches
}: {
  crossSells: CrossSell[];
  menuItems: MenuItem[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const itemsById = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  // Group cross-sells by parent
  const grouped = useMemo(() => {
    const map = new Map<string, CrossSell[]>();
    for (const cs of crossSells) {
      const arr = map.get(cs.parentItemId) ?? [];
      arr.push(cs);
      map.set(cs.parentItemId, arr);
    }
    // Sort each group by sortOrder
    for (const arr of map.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return Array.from(map.entries()).map(([parentId, rows]) => ({
      parent: itemsById.get(parentId),
      parentId,
      rows
    })).filter((g) => g.parent);
  }, [crossSells, itemsById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter((g) => {
      if (g.parent?.name.toLowerCase().includes(q)) return true;
      return g.rows.some((r) => itemsById.get(r.suggestedItemId)?.name.toLowerCase().includes(q));
    });
  }, [grouped, search, itemsById]);

  const empty = crossSells.length === 0;

  return (
    <div className="space-y-4">
      {empty && !composerOpen && (
        <EmptyState
          icon={Layers}
          title="No cross-sell pairs yet"
          description='Suggest desserts on a biryani PDP, or add a Coke when someone has a burger in cart. Pick a parent item, choose what to suggest, and decide whether to surface it on the product page, the cart, or both.'
          action={
            <Button onClick={() => setComposerOpen(true)}>
              <Plus className="size-4" /> Get started
            </Button>
          }
        />
      )}

      {!empty && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9"
              placeholder="Search by parent or suggested item"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {crossSells.length} pair{crossSells.length === 1 ? '' : 's'} across {grouped.length} parent item{grouped.length === 1 ? '' : 's'}
          </div>
          <div className="ml-auto">
            {!composerOpen && (
              <Button onClick={() => setComposerOpen(true)}>
                <Plus className="size-4" /> Add cross-sell
              </Button>
            )}
          </div>
        </div>
      )}

      {composerOpen && (
        <Composer
          menuItems={menuItems}
          branches={branches}
          onSaved={() => { setComposerOpen(false); router.refresh(); }}
          onCancel={() => setComposerOpen(false)}
        />
      )}

      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((g) => (
            <Card key={g.parentId}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{g.parent?.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {branches.find((b) => b.id === g.parent?.branchId)?.name ?? '—'} · {money(Number(g.parent?.price ?? 0))} · {g.rows.length} suggestion{g.rows.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
                {(() => {
                  const byKind = new Map<string, CrossSell[]>();
                  for (const row of g.rows) {
                    const k = row.kind ?? 'frequently_together';
                    const arr = byKind.get(k) ?? [];
                    arr.push(row);
                    byKind.set(k, arr);
                  }
                  // Render kinds in the canonical order
                  const order = KIND_OPTIONS.map((o) => o.value).filter((k) => byKind.has(k));
                  // Append any unknown kinds at the end
                  for (const k of byKind.keys()) if (!order.includes(k as Kind)) order.push(k as Kind);
                  return (
                    <div className="space-y-2">
                      {order.map((k) => (
                        <div key={k} className="rounded-md border">
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                              {KIND_LABEL[k] ?? k}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{byKind.get(k)!.length} suggestion{byKind.get(k)!.length === 1 ? '' : 's'}</span>
                          </div>
                          <div className="divide-y">
                            {byKind.get(k)!.map((row) => (
                              <CrossSellRow
                                key={row.id}
                                row={row}
                                suggested={itemsById.get(row.suggestedItemId)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!empty && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          title="No matches"
          description="Try a different keyword or clear the search."
        />
      )}
    </div>
  );
}

// ─── Composer ────────────────────────────────────────────────────────────────

function Composer({
  menuItems, branches, onSaved, onCancel
}: {
  menuItems: MenuItem[];
  branches: Branch[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [parentId, setParentId] = useState('');
  const [suggestedId, setSuggestedId] = useState('');
  const [surfaces, setSurfaces] = useState<Surface[]>(['pdp', 'cart']);
  const [kind, setKind] = useState<Kind>('frequently_together');
  const [busy, setBusy] = useState(false);

  // Limit suggestions to the same branch as the parent so admins don't
  // accidentally cross-sell items that won't be in the same cart.
  const parent = menuItems.find((m) => m.id === parentId);
  const suggestedOptions = parent ? menuItems.filter((m) => m.branchId === parent.branchId && m.id !== parent.id) : menuItems;

  function toggleSurface(s: Surface) {
    setSurfaces((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function save() {
    if (!parentId || !suggestedId) {
      toast.error('Pick both a parent and a suggested item');
      return;
    }
    if (parentId === suggestedId) {
      toast.error('Parent and suggested must be different items');
      return;
    }
    if (surfaces.length === 0) {
      toast.error('Pick at least one surface (PDP or Cart)');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/admin/cross-sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentItemId: parentId,
          suggestedItemId: suggestedId,
          surface: surfaces.join(','),
          sortOrder: 0,
          kind
        })
      });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('Cross-sell added');
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">New cross-sell pair</div>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label>Parent item</Label>
            <ItemSelect
              items={menuItems}
              branches={branches}
              value={parentId}
              onChange={(id) => { setParentId(id); setSuggestedId(''); }}
              placeholder="Pick parent"
            />
          </div>
          <div>
            <Label>Suggested item</Label>
            <ItemSelect
              items={suggestedOptions}
              branches={branches}
              value={suggestedId}
              onChange={setSuggestedId}
              placeholder={parent ? 'Pick suggestion' : 'Pick parent first'}
              disabled={!parent}
            />
          </div>
          <div>
            <Label>Group</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground mt-1">Which section this appears in on the PDP.</div>
          </div>
          <div>
            <Label>Surfaces</Label>
            <div className="mt-1 flex gap-1.5">
              {SURFACE_OPTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSurface(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${surfaces.includes(s) ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
                >
                  {s === 'pdp' ? 'Product page' : 'Cart'}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">Pick where the suggestion appears.</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ItemSelect({
  items, branches, value, onChange, placeholder, disabled
}: {
  items: MenuItem[];
  branches: Branch[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  // Group by branch for clarity
  const byBranch = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const i of items) {
      const arr = map.get(i.branchId) ?? [];
      arr.push(i);
      map.set(i.branchId, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <Select value={value || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)} disabled={disabled}>
      <SelectTrigger className="mt-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— {placeholder} —</SelectItem>
        {byBranch.map(([branchId, list]) => (
          <div key={branchId}>
            <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              {branches.find((b) => b.id === branchId)?.name ?? 'Branch'}
            </div>
            {list.map((i) => (
              <SelectItem key={i.id} value={i.id}>{i.name}{!i.isAvailable && ' (unavailable)'}</SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function CrossSellRow({ row, suggested }: { row: CrossSell; suggested: MenuItem | undefined }) {
  const router = useRouter();
  const [sortOrder, setSortOrder] = useState(row.sortOrder);
  const [busy, setBusy] = useState(false);
  const surfaces = (row.surface ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  async function remove() {
    if (!confirm('Remove this cross-sell?')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/cross-sell/${row.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('Removed');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function persistOrder(next: number) {
    setSortOrder(next);
    // PATCH the existing row — re-POSTing would hit the unique
    // [parentItemId, suggestedItemId, kind] constraint (P2002 → 409) and never
    // update the order. The [id] PATCH route handles sortOrder directly.
    const r = await fetch(`/api/admin/cross-sell/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: next })
    });
    if (!r.ok) {
      toast.error('Failed to save order');
      setSortOrder(row.sortOrder);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{suggested?.name ?? 'Unknown item'}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {suggested ? money(Number(suggested.price)) : '—'}
          {row.source !== 'manual' && <> · <Badge variant="muted" className="text-[10px] ml-1">{row.source}</Badge></>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {surfaces.includes('pdp') && <Badge variant="secondary" className="text-[10px]">PDP</Badge>}
        {surfaces.includes('cart') && <Badge variant="secondary" className="text-[10px]">Cart</Badge>}
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px] text-muted-foreground">Order</Label>
        <Input
          type="number"
          className="h-8 w-16 text-xs"
          value={String(sortOrder)}
          onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
          onBlur={() => { if (sortOrder !== row.sortOrder) persistOrder(sortOrder); }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={remove}
        disabled={busy}
        className="text-destructive hover:bg-destructive/10"
        aria-label="Remove cross-sell"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
