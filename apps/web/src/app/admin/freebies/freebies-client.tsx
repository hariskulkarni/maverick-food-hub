'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { Plus, Pencil, Power, Gift, PackagePlus, Trash2 } from 'lucide-react';

interface MenuItemLite { id: string; name: string; isAvailable: boolean }

interface FreebieRow {
  id: string;
  menuItemId: string;
  itemName: string;
  name: string;
  minOrderAmount: number;
  stock: number;
  totalGranted: number;
  isActive: boolean;
  sortOrder: number;
}

export function FreebiesClient({
  allowFreebies, initialRules, menuItems
}: { allowFreebies: boolean; initialRules: FreebieRow[]; menuItems: MenuItemLite[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FreebieRow | null>(null);
  const [open, setOpen] = useState(false);

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(r: FreebieRow) { setEditing(r); setOpen(true); }

  // Per-row in-flight set so the Pause/Restock/Delete buttons on a single
  // freebie disable while their PATCH is on the wire — without freezing all
  // OTHER rows. A naive global `busy` flag would make rapid-fire admin work
  // feel sluggish; per-id is the minimum that actually stops double-submits.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const isPending = (id: string) => pending.has(id);
  function markPending(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function toggleActive(r: FreebieRow) {
    if (isPending(r.id)) return;
    markPending(r.id, true);
    try {
      const res = await fetch(`/api/admin/freebies/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !r.isActive })
      });
      if (!res.ok) { await reportApiError(res, 'Update failed'); return; }
      toast.success(r.isActive ? 'Freebie paused' : 'Freebie activated');
      router.refresh();
    } finally { markPending(r.id, false); }
  }

  async function restock(r: FreebieRow, by: number) {
    if (isPending(r.id)) return;
    markPending(r.id, true);
    try {
      const res = await fetch(`/api/admin/freebies/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: r.stock + by })
      });
      if (!res.ok) { await reportApiError(res, 'Restock failed'); return; }
      toast.success(`Restocked +${by}`);
      router.refresh();
    } finally { markPending(r.id, false); }
  }

  async function remove(r: FreebieRow) {
    if (isPending(r.id)) return;
    if (!confirm(`Delete freebie rule "${r.name}"?`)) return;
    markPending(r.id, true);
    try {
      const res = await fetch(`/api/admin/freebies/${r.id}`, { method: 'DELETE' });
      if (!res.ok) { await reportApiError(res, 'Delete failed'); return; }
      toast.success('Freebie deleted');
      router.refresh();
    } finally { markPending(r.id, false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Gift className="size-5" />
          </div>
          <div>
            <h1 className="display text-2xl font-semibold">Freebies</h1>
            <p className="text-sm text-muted-foreground">Reward customers with a free gift when their order clears a spend threshold.</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} disabled={menuItems.length === 0}><Plus className="size-4" /> Add freebie</Button>
          </DialogTrigger>
          <FreebieDialog editing={editing} menuItems={menuItems} onDone={() => { setOpen(false); router.refresh(); }} />
        </Dialog>
      </header>

      {!allowFreebies && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Freebies are currently turned off. You can still set up rules here; enable them in{' '}
          <span className="font-medium">Settings → Order flow</span> to start granting gifts.
        </div>
      )}

      {menuItems.length === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Add menu items first — a freebie rule gifts one of your menu items for free.
        </div>
      )}

      {initialRules.length === 0 ? (
        <Card><CardContent className="p-0">
          <EmptyState
            icon={Gift}
            title="No freebies yet"
            description="Create a rule like “Free dessert over ₹399” to delight customers at checkout."
          />
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {initialRules.map((r) => (
            <Card key={r.id} className={r.isActive ? '' : 'opacity-60'}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {!r.isActive && <Badge variant="muted">Paused</Badge>}
                    {r.stock === 0 && <Badge variant="muted">Out of stock</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    🎁 {r.itemName} · spend ≥ {money(r.minOrderAmount)} · {r.stock} in stock · {r.totalGranted} granted
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={isPending(r.id)} onClick={() => restock(r, 10)} title="Restock +10">
                    <PackagePlus className="size-4" /> +10
                  </Button>
                  <Button variant="ghost" size="sm" disabled={isPending(r.id)} onClick={() => openEdit(r)} title="Edit">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={isPending(r.id)} onClick={() => toggleActive(r)} title={r.isActive ? 'Pause' : 'Activate'}>
                    <Power className={`size-4 ${r.isActive ? 'text-destructive' : 'text-success'}`} />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={isPending(r.id)} onClick={() => remove(r)} title="Delete">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FreebieDialog({ editing, menuItems, onDone }: { editing: FreebieRow | null; menuItems: MenuItemLite[]; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [menuItemId, setMenuItemId] = useState(editing?.menuItemId ?? menuItems[0]?.id ?? '');
  const [minOrderAmount, setMinOrderAmount] = useState(editing?.minOrderAmount ?? 399);
  const [stock, setStock] = useState(editing?.stock ?? 50);
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = JSON.stringify({ name, menuItemId, minOrderAmount, stock, sortOrder, isActive });
      const res = editing
        ? await fetch(`/api/admin/freebies/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
        : await fetch('/api/admin/freebies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) { await reportApiError(res, 'Save failed'); return; }
      toast.success(editing ? 'Freebie updated' : 'Freebie added');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit freebie' : 'Add freebie'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Rule name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Free dessert over ₹399" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Gift item</Label>
          <select
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
            className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.isAvailable ? '' : ' (unavailable)'}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Min order amount (₹)</Label>
            <Input type="number" min={0} step="1" value={minOrderAmount} onChange={(e) => setMinOrderAmount(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Stock</Label>
            <Input type="number" min={0} value={stock} onChange={(e) => setStock(Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Sort order</Label>
            <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
          <div className="flex items-center justify-between pb-2">
            <Label className="text-sm">Active</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={busy || !name.trim() || !menuItemId}>
          {busy ? 'Saving…' : editing ? 'Save freebie' : 'Add freebie'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
