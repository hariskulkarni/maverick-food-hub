'use client';
/**
 * Combos manager — admin UI for curating combo meals.
 *
 *   <CombosManager />
 *     – KPI strip (total / active / avg price / avg items per combo)
 *     – Search box + active/all filter chips
 *     – Card list per combo with image, name, price, items chip, switch, edit/delete
 *     – New combo button opens the ComboEditor dialog
 *     – Empty state CTA suggesting "Family Bundle — 2 mains + 1 starter + 1 dessert"
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, Package, Search, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { ComboEditor, type ComboDraft, type MenuItemRef } from './combo-editor';

export type Combo = {
  id: string;
  branchId: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  items: {
    id: string;
    menuItemId: string;
    quantity: number;
    menuItem: { id: string; name: string; price: number | string; isAvailable: boolean; imageUrl: string | null };
  }[];
};

export function CombosManager({
  branchId, combos, menuItems, categories
}: {
  branchId: string;
  combos: Combo[];
  menuItems: MenuItemRef[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ComboDraft | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active'>('all');

  const empty = combos.length === 0;

  // ─── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = combos.length;
    const active = combos.filter((c) => c.isAvailable).length;
    const avgPrice = total === 0
      ? 0
      : combos.reduce((s, c) => s + Number(c.price ?? 0), 0) / total;
    const avgItems = total === 0
      ? 0
      : combos.reduce((s, c) => s + c.items.length, 0) / total;
    return { total, active, avgPrice, avgItems };
  }, [combos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combos.filter((c) => {
      if (filter === 'active' && !c.isAvailable) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.description ?? '').toLowerCase().includes(q)) return true;
      if (c.items.some((i) => i.menuItem.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [combos, search, filter]);

  async function toggleAvailable(c: Combo, next: boolean) {
    const r = await fetch(`/api/admin/combos/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAvailable: next })
    });
    if (!r.ok) {
      await reportApiError(r, next ? 'Could not activate combo' : 'Could not deactivate combo');
      return;
    }
    toast.success(next ? 'Combo activated' : 'Combo deactivated');
    router.refresh();
  }

  async function remove(c: Combo) {
    if (!confirm(`Delete combo "${c.name}"?`)) return;
    const r = await fetch(`/api/admin/combos/${c.id}`, { method: 'DELETE' });
    if (!r.ok) {
      await reportApiError(r, 'Could not delete combo');
      return;
    }
    toast.success('Combo deleted');
    router.refresh();
  }

  function newCombo() {
    setEditing({
      id: null,
      branchId,
      name: '',
      slug: '',
      description: '',
      price: 0,
      imageUrl: null,
      isAvailable: true,
      sortOrder: 0,
      items: []
    });
  }

  function editCombo(c: Combo) {
    setEditing({
      id: c.id,
      branchId: c.branchId,
      name: c.name,
      slug: c.slug,
      description: c.description ?? '',
      price: Number(c.price),
      imageUrl: c.imageUrl,
      isAvailable: c.isAvailable,
      sortOrder: c.sortOrder,
      items: c.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }))
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (empty) {
    return (
      <>
        <EmptyState
          icon={Package}
          title="No combos yet"
          description='Bundle a few menu items into a combo with its own price — e.g. "Family Bundle — 2 mains + 1 starter + 1 dessert" — to drive average order value.'
          action={
            <Button onClick={newCombo}>
              <Plus className="size-4" /> New combo
            </Button>
          }
        />
        {editing && (
          <ComboEditor
            draft={editing}
            menuItems={menuItems}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); router.refresh(); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total combos"    value={String(kpis.total)} />
        <Kpi label="Active"          value={String(kpis.active)} />
        <Kpi label="Avg combo price" value={money(kpis.avgPrice)} />
        <Kpi label="Avg items / combo" value={kpis.avgItems.toFixed(1)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[180px] max-w-sm">
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-9"
            placeholder="Search combos or contained items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          <FilterChip active={filter === 'all'}    onClick={() => setFilter('all')}>All</FilterChip>
          <FilterChip active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterChip>
        </div>
        <div className="ml-auto">
          <Button onClick={newCombo}>
            <Plus className="size-4" /> New combo
          </Button>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description="Try a different keyword or switch the filter."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const unavailableMembers = c.items.filter((i) => !i.menuItem.isAvailable);
            const itemsText = c.items.map((i) => `${i.quantity}× ${i.menuItem.name}`).join(', ');
            return (
              <Card key={c.id} className="tap-press card-lift">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted border">
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                        <Package className="size-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{c.name}</div>
                      {!c.isAvailable && <Badge variant="muted" className="text-[10px]">Inactive</Badge>}
                      {unavailableMembers.length > 0 && (
                        <Badge variant="destructive" className="text-[10px]" title={unavailableMembers.map((m) => m.menuItem.name).join(', ')}>
                          <AlertTriangle className="size-3 mr-1" />
                          {unavailableMembers.length} unavailable
                        </Badge>
                      )}
                    </div>
                    {c.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{c.description}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-[10px]" title={itemsText}>
                        {c.items.length} item{c.items.length === 1 ? '' : 's'}
                      </Badge>
                      <span className="truncate">{itemsText}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-semibold">{money(c.price)}</div>
                    </div>
                    <Switch
                      checked={c.isAvailable}
                      onCheckedChange={(v) => toggleAvailable(c, v)}
                      aria-label="Toggle availability"
                    />
                    <Button variant="ghost" size="icon" onClick={() => editCombo(c)} aria-label="Edit combo">
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(c)}
                      className="text-destructive hover:bg-destructive/10"
                      aria-label="Delete combo"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <ComboEditor
          draft={editing}
          menuItems={menuItems}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="display text-xl font-semibold mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}
