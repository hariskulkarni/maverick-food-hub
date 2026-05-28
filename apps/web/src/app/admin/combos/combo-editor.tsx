'use client';
/**
 * ComboEditor — create/edit dialog for a Combo.
 *
 *   Fields:
 *     - name, slug (auto-derived but editable), description, price, sortOrder
 *     - isAvailable switch
 *     - image (ImageUploader)
 *     - items: chip-style picker for menu items + quantity input per chosen item
 *
 *   Validation:
 *     - name required
 *     - price >= 0
 *     - at least 2 items
 *     - live warning when any selected menuItem.isAvailable === false
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ImageUploader } from '@/components/image-uploader';
import { AlertTriangle, X, Plus } from 'lucide-react';
import { toast } from 'sonner';

export type MenuItemRef = {
  id: string;
  name: string;
  price: number | string;
  isAvailable: boolean;
  categoryId: string;
  imageUrl: string | null;
};

export type ComboDraft = {
  id: string | null;
  branchId: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  items: { menuItemId: string; quantity: number }[];
};

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ComboEditor({
  draft, menuItems, onClose, onSaved
}: {
  draft: ComboDraft;
  menuItems: MenuItemRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ComboDraft>(draft);
  const [slugTouched, setSlugTouched] = useState(Boolean(draft.slug));
  const [busy, setBusy] = useState(false);
  const isNew = !form.id;

  const itemsById = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  // Auto-derive slug from name when the admin hasn't touched it.
  useEffect(() => {
    if (!slugTouched) {
      setForm((f) => ({ ...f, slug: slugify(f.name) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name]);

  function setField<K extends keyof ComboDraft>(k: K, v: ComboDraft[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleItem(id: string) {
    setForm((f) => {
      const idx = f.items.findIndex((i) => i.menuItemId === id);
      if (idx >= 0) {
        const next = f.items.slice();
        next.splice(idx, 1);
        return { ...f, items: next };
      }
      return { ...f, items: [...f.items, { menuItemId: id, quantity: 1 }] };
    });
  }

  function setQty(id: string, qty: number) {
    setForm((f) => ({
      ...f,
      items: f.items.map((i) => i.menuItemId === id ? { ...i, quantity: Math.max(1, qty) } : i)
    }));
  }

  const selectedIds = new Set(form.items.map((i) => i.menuItemId));
  // Live availability warning — flag any unavailable item in the basket.
  const unavailable = form.items
    .map((i) => itemsById.get(i.menuItemId))
    .filter((m): m is MenuItemRef => !!m && !m.isAvailable);

  async function save() {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (form.price < 0) {
      toast.error('Price cannot be negative');
      return;
    }
    if (form.items.length < 2) {
      toast.error('Pick at least 2 menu items');
      return;
    }
    setBusy(true);
    try {
      const body = {
        branchId: form.branchId,
        name: form.name.trim(),
        slug: form.slug.trim() || slugify(form.name),
        description: form.description.trim() || null,
        price: form.price,
        imageUrl: form.imageUrl,
        isAvailable: form.isAvailable,
        sortOrder: form.sortOrder,
        items: form.items
      };
      const url = isNew ? '/api/admin/combos' : `/api/admin/combos/${form.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success(isNew ? 'Combo created' : 'Combo updated');
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function deleteCombo() {
    if (!form.id) return;
    if (!confirm(`Delete combo "${form.name}"?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/combos/${form.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('Combo deleted');
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New combo' : `Edit combo · ${draft.name}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Family Bundle"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                className="mt-1"
                value={form.slug}
                onChange={(e) => { setSlugTouched(true); setField('slug', e.target.value); }}
                placeholder="family-bundle"
              />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="2 mains + 1 starter + 1 dessert, serves 4."
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Price</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                step="0.01"
                value={String(form.price)}
                onChange={(e) => setField('price', Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label>Sort order</Label>
              <Input
                className="mt-1"
                type="number"
                value={String(form.sortOrder)}
                onChange={(e) => setField('sortOrder', Number(e.target.value) || 0)}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                checked={form.isAvailable}
                onCheckedChange={(v) => setField('isAvailable', v)}
                aria-label="Available"
              />
              <Label className="cursor-pointer" onClick={() => setField('isAvailable', !form.isAvailable)}>
                {form.isAvailable ? 'Available' : 'Inactive'}
              </Label>
            </div>
          </div>

          <div>
            <Label>Image</Label>
            <ImageUploader
              value={form.imageUrl}
              onChange={(url) => setField('imageUrl', url)}
              folder="combos"
              aspect="video"
              recommended="1200×675 px (16:9) or 800×800 (square) · shown on the customer menu card"
            />
          </div>

          <div>
            <Label>Items (pick at least 2)</Label>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Click an item to add it to the combo. Tap again to remove. Adjust quantity in the chip below.
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
              {menuItems.map((m) => {
                const on = selectedIds.has(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => toggleItem(m.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'} ${!m.isAvailable ? 'italic' : ''}`}
                    title={m.isAvailable ? '' : 'Currently unavailable'}
                  >
                    {on && <Plus className="size-3 inline rotate-45" aria-hidden />}
                    {m.name}
                    {!m.isAvailable && ' (unavailable)'}
                  </button>
                );
              })}
              {menuItems.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No menu items in this branch yet.</div>
              )}
            </div>

            {form.items.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {form.items.map((row) => {
                  const m = itemsById.get(row.menuItemId);
                  if (!m) return null;
                  return (
                    <div key={row.menuItemId} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                      <span className="text-sm font-medium flex-1 truncate">{m.name}</span>
                      {!m.isAvailable && (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="size-3 mr-1" /> Unavailable
                        </Badge>
                      )}
                      <Label className="text-[11px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-16 text-xs"
                        value={String(row.quantity)}
                        onChange={(e) => setQty(row.menuItemId, Number(e.target.value) || 1)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleItem(row.menuItemId)}
                        aria-label={`Remove ${m.name}`}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {unavailable.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-warning">Unavailable ingredient{unavailable.length === 1 ? '' : 's'}</div>
                  <div className="mt-0.5">
                    Combo cannot be ordered while {unavailable.map((u) => u.name).join(', ')} {unavailable.length === 1 ? 'is' : 'are'} unavailable. You can still save it; customers won't see it until every item is back in stock.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t mt-2">
          {!isNew && (
            <Button variant="ghost" onClick={deleteCombo} disabled={busy} className="mr-auto text-destructive hover:bg-destructive/10">
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
