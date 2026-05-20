'use client';
/**
 * Variant + modifier-group editor for a single menu item. Dropped inside the
 * item edit dialog (see menu-manager.tsx). Loads existing variants & modifier
 * groups on mount and lets the admin add / edit / delete each, plus a one-tap
 * "Suggest sizes" that seeds variant rows from the dish name.
 *
 * Persistence is refetch-after-save against the CRUD routes under
 *   /api/admin/menu/items/[id]/variants
 *   /api/admin/menu/items/[id]/modifier-groups[/.../options]
 *
 * Props (kept stable so the customer-side picker stays consistent):
 *   menuItemId: string  — the item these belong to
 *   itemName:   string  — used by "Suggest sizes" (suggestVariantsForName)
 *
 * Server JSON shapes (Decimal already → Number):
 *   Variant { id, menuItemId, name, price, isDefault, isAvailable, sortOrder }
 *   Group   { id, menuItemId, name, minSelect, maxSelect, required, sortOrder,
 *             options: Option[] }
 *   Option  { id, modifierGroupId, name, priceDelta, isDefault, isAvailable, sortOrder }
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { suggestVariantsForName } from '@/server/indian-menu-catalog';

export type EditorVariant = {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

export type EditorOption = {
  id: string;
  modifierGroupId: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

export type EditorGroup = {
  id: string;
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  sortOrder: number;
  options: EditorOption[];
};

export type VariantModifierEditorProps = {
  menuItemId: string;
  itemName: string;
};

async function jsonFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
  });
  if (!r.ok) throw new Error((await r.text()) || `${r.status}`);
  return r.json();
}

export function VariantModifierEditor({ menuItemId, itemName }: VariantModifierEditorProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [variants, setVariants] = useState<EditorVariant[]>([]);
  const [groups, setGroups] = useState<EditorGroup[]>([]);

  const base = `/api/admin/menu/items/${menuItemId}`;

  const reload = useCallback(async () => {
    const [v, g] = await Promise.all([
      jsonFetch(`${base}/variants`),
      jsonFetch(`${base}/modifier-groups`),
    ]);
    setVariants(v);
    setGroups(g);
  }, [base]);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      try {
        await reload();
      } catch (e) {
        toast.error('Could not load variants: ' + (e as Error).message);
      } finally {
        setLoaded(true);
      }
    })();
  }, [open, loaded, reload]);

  const variantSummary =
    variants.length > 0 ? `${variants.length} size${variants.length === 1 ? '' : 's'}` : '';
  const groupSummary =
    groups.length > 0 ? `${groups.length} add-on group${groups.length === 1 ? '' : 's'}` : '';
  const summary = [variantSummary, groupSummary].filter(Boolean).join(' · ') || 'None yet';

  return (
    <div className="mt-4 rounded-lg border bg-card">
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Variants &amp; add-ons
        </span>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div className="border-t p-3 space-y-6">
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <VariantsSection
                menuItemId={menuItemId}
                itemName={itemName}
                variants={variants}
                onChanged={reload}
              />
              <ModifierGroupsSection menuItemId={menuItemId} groups={groups} onChanged={reload} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Variants ────────────────────────────────────────────────────────────────

function VariantsSection({
  menuItemId,
  itemName,
  variants,
  onChanged,
}: {
  menuItemId: string;
  itemName: string;
  variants: EditorVariant[];
  onChanged: () => Promise<void>;
}) {
  const base = `/api/admin/menu/items/${menuItemId}/variants`;
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');

  async function addVariant(name: string, price: number, isDefault = false) {
    setBusy(true);
    try {
      await jsonFetch(base, {
        method: 'POST',
        body: JSON.stringify({ name, price, isDefault, sortOrder: variants.length }),
      });
      await onChanged();
    } catch (e) {
      toast.error('Add failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggestSizes() {
    const names = suggestVariantsForName(itemName);
    if (names.length === 0) {
      toast.info('No size suggestions for this item name.');
      return;
    }
    const existing = new Set(variants.map((v) => v.name.toLowerCase()));
    const toAdd = names.filter((n) => !existing.has(n.toLowerCase()));
    if (toAdd.length === 0) {
      toast.info('Suggested sizes already added.');
      return;
    }
    setBusy(true);
    try {
      // First suggested size becomes default when no variant exists yet.
      let order = variants.length;
      for (let i = 0; i < toAdd.length; i++) {
        await jsonFetch(base, {
          method: 'POST',
          body: JSON.stringify({
            name: toAdd[i],
            price: 0,
            isDefault: variants.length === 0 && i === 0,
            sortOrder: order++,
          }),
        });
      }
      await onChanged();
      toast.success(`Added ${toAdd.length} suggested size${toAdd.length === 1 ? '' : 's'} — set prices`);
    } catch (e) {
      toast.error('Suggest failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Sizes / variants</h4>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={suggestSizes} className="gap-1.5">
          <Sparkles className="size-3.5" /> Suggest sizes
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        When set, the customer picks exactly one and its price replaces the base price.
      </p>

      <div className="grid gap-2">
        {variants.map((v) => (
          <VariantRow key={v.id} menuItemId={menuItemId} variant={v} onChanged={onChanged} />
        ))}
        {variants.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No variants — item uses its base price.</p>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 pt-1"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          await addVariant(newName.trim(), Number(newPrice) || 0, variants.length === 0);
          setNewName('');
          setNewPrice('');
        }}
      >
        <div className="flex-1 min-w-[120px]">
          <Label className="text-xs">Name</Label>
          <Input className="mt-1 h-9" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Full" />
        </div>
        <div className="w-28">
          <Label className="text-xs">Price (₹)</Label>
          <Input className="mt-1 h-9" type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0" />
        </div>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()} className="gap-1.5">
          <Plus className="size-3.5" /> Add
        </Button>
      </form>
    </section>
  );
}

function VariantRow({
  menuItemId,
  variant,
  onChanged,
}: {
  menuItemId: string;
  variant: EditorVariant;
  onChanged: () => Promise<void>;
}) {
  const url = `/api/admin/menu/items/${menuItemId}/variants/${variant.id}`;
  const [name, setName] = useState(variant.name);
  const [price, setPrice] = useState(String(variant.price));
  const [busy, setBusy] = useState(false);

  const dirty = name !== variant.name || Number(price) !== variant.price;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
      await onChanged();
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete variant "${variant.name}"?`)) return;
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      toast.error('Delete failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
      <Input className="h-9 flex-1 min-w-[120px]" value={name} onChange={(e) => setName(e.target.value)} />
      <Input className="h-9 w-24" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={variant.isDefault} disabled={busy} onCheckedChange={(v) => patch({ isDefault: !!v })} />
        Default
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={variant.isAvailable} disabled={busy} onCheckedChange={(v) => patch({ isAvailable: !!v })} />
        Available
      </label>
      {dirty && (
        <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => patch({ name: name.trim(), price: Number(price) || 0 })}>
          Save
        </Button>
      )}
      <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={remove} aria-label="Delete variant">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// ── Modifier groups ───────────────────────────────────────────────────────────

function ModifierGroupsSection({
  menuItemId,
  groups,
  onChanged,
}: {
  menuItemId: string;
  groups: EditorGroup[];
  onChanged: () => Promise<void>;
}) {
  const base = `/api/admin/menu/items/${menuItemId}/modifier-groups`;
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await jsonFetch(base, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), sortOrder: groups.length }),
      });
      setNewName('');
      await onChanged();
    } catch (e) {
      toast.error('Add failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">Add-on groups</h4>
      <p className="text-xs text-muted-foreground">
        Optional extras (toppings, spice level). Set min/max to control how many the customer picks.
      </p>

      <div className="grid gap-3">
        {groups.map((g) => (
          <ModifierGroupCard key={g.id} menuItemId={menuItemId} group={g} onChanged={onChanged} />
        ))}
        {groups.length === 0 && <p className="text-xs text-muted-foreground italic">No add-on groups yet.</p>}
      </div>

      <form className="flex flex-wrap items-end gap-2 pt-1" onSubmit={addGroup}>
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">New group name</Label>
          <Input className="mt-1 h-9" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Add-ons" />
        </div>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()} className="gap-1.5">
          <Plus className="size-3.5" /> Add group
        </Button>
      </form>
    </section>
  );
}

function ModifierGroupCard({
  menuItemId,
  group,
  onChanged,
}: {
  menuItemId: string;
  group: EditorGroup;
  onChanged: () => Promise<void>;
}) {
  const url = `/api/admin/menu/items/${menuItemId}/modifier-groups/${group.id}`;
  const optBase = `${url}/options`;
  const [name, setName] = useState(group.name);
  const [minSelect, setMinSelect] = useState(String(group.minSelect));
  const [maxSelect, setMaxSelect] = useState(String(group.maxSelect));
  const [busy, setBusy] = useState(false);
  const [optName, setOptName] = useState('');
  const [optDelta, setOptDelta] = useState('');

  const dirty =
    name !== group.name ||
    Number(minSelect) !== group.minSelect ||
    Number(maxSelect) !== group.maxSelect;

  async function patchGroup(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
      await onChanged();
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!confirm(`Delete group "${group.name}" and its options?`)) return;
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      toast.error('Delete failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addOption(e: React.FormEvent) {
    e.preventDefault();
    if (!optName.trim()) return;
    setBusy(true);
    try {
      await jsonFetch(optBase, {
        method: 'POST',
        body: JSON.stringify({
          name: optName.trim(),
          priceDelta: Number(optDelta) || 0,
          sortOrder: group.options.length,
        }),
      });
      setOptName('');
      setOptDelta('');
      await onChanged();
    } catch (e) {
      toast.error('Add option failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-background p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Group name</Label>
          <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-20">
          <Label className="text-xs">Min</Label>
          <Input className="mt-1 h-9" type="number" min={0} value={minSelect} onChange={(e) => setMinSelect(e.target.value)} />
        </div>
        <div className="w-20">
          <Label className="text-xs">Max</Label>
          <Input className="mt-1 h-9" type="number" min={1} value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
          <Switch checked={group.required} disabled={busy} onCheckedChange={(v) => patchGroup({ required: !!v })} />
          Required
        </label>
        {dirty && (
          <Button
            type="button"
            size="sm"
            disabled={busy || !name.trim()}
            onClick={() =>
              patchGroup({
                name: name.trim(),
                minSelect: Math.max(0, Number(minSelect) || 0),
                maxSelect: Math.max(1, Number(maxSelect) || 1),
              })
            }
          >
            Save
          </Button>
        )}
        <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={removeGroup} aria-label="Delete group">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-1.5 pl-1">
        {group.options.map((o) => (
          <OptionRow key={o.id} optBaseUrl={optBase} option={o} onChanged={onChanged} />
        ))}
        {group.options.length === 0 && <p className="text-xs text-muted-foreground italic">No options yet.</p>}
      </div>

      <form className="flex flex-wrap items-end gap-2" onSubmit={addOption}>
        <div className="flex-1 min-w-[120px]">
          <Label className="text-xs">Option</Label>
          <Input className="mt-1 h-9" value={optName} onChange={(e) => setOptName(e.target.value)} placeholder="e.g. Extra cheese" />
        </div>
        <div className="w-28">
          <Label className="text-xs">+ Price (₹)</Label>
          <Input className="mt-1 h-9" type="number" value={optDelta} onChange={(e) => setOptDelta(e.target.value)} placeholder="0" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !optName.trim()} className="gap-1.5">
          <Plus className="size-3.5" /> Add option
        </Button>
      </form>
    </div>
  );
}

function OptionRow({
  optBaseUrl,
  option,
  onChanged,
}: {
  optBaseUrl: string;
  option: EditorOption;
  onChanged: () => Promise<void>;
}) {
  const url = `${optBaseUrl}/${option.id}`;
  const [name, setName] = useState(option.name);
  const [delta, setDelta] = useState(String(option.priceDelta));
  const [busy, setBusy] = useState(false);

  const dirty = name !== option.name || Number(delta) !== option.priceDelta;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
      await onChanged();
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await jsonFetch(url, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      toast.error('Delete failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-1.5">
      <Input className="h-8 flex-1 min-w-[100px]" value={name} onChange={(e) => setName(e.target.value)} />
      <Input className="h-8 w-24" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} />
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={option.isAvailable} disabled={busy} onCheckedChange={(v) => patch({ isAvailable: !!v })} />
        Available
      </label>
      {dirty && (
        <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => patch({ name: name.trim(), priceDelta: Number(delta) || 0 })}>
          Save
        </Button>
      )}
      <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={remove} aria-label="Delete option">
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
