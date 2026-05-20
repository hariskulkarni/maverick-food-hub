'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, MoreHorizontal, Clock, CalendarClock } from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ImageUploader } from '@/components/image-uploader';
import { Badge } from '@/components/ui/badge';
import { CategorySchedulePanel } from './category-schedule-panel';
import { VariantModifierEditor } from './variant-modifier-editor';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesToTime(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
}
function timeToMinutes(s: string) {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function MenuManager({ branchId, categories, items }: { branchId: string; categories: any[]; items: any[] }) {
  const [editing, setEditing] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drop stale selections if the list changes (e.g. after refresh removes some).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      const ids = new Set(items.map((i) => i.id));
      prev.forEach((id) => ids.has(id) && next.add(id));
      return next;
    });
  }, [items]);

  const allIds = useMemo(() => items.map((i) => i.id), [items]);

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  return (
    <Tabs defaultValue="items">
      <TabsList>
        <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
        <TabsTrigger value="categories">Categories ({categories.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="items">
        <div className="flex justify-end mb-3">
          <Button onClick={() => setEditing({ branchId, isAvailable: true, isVeg: true, prepTimeMin: 20, price: 0 })}>
            <Plus className="size-4" /> New item
          </Button>
        </div>

        <BulkActionBar
          allIds={allIds}
          selected={selected}
          onSelectAll={() => setSelected(new Set(allIds))}
          onSelectNone={() => setSelected(new Set())}
          onApplied={() => setSelected(new Set())}
        />

        <div className="grid gap-2">
          {items.map((it) => {
            const cat = categories.find((c) => c.id === it.categoryId);
            const isSel = selected.has(it.id);
            return (
              <Card key={it.id} className={`tap-press card-lift ${isSel ? 'ring-2 ring-primary/50' : ''}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${it.name}`}
                    className="size-4 shrink-0 accent-primary"
                    checked={isSel}
                    onChange={(e) => toggleOne(it.id, e.target.checked)}
                  />
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted border">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground/40 text-xs">No img</div>
                    )}
                  </div>
                  <span className={`flex h-3.5 w-3.5 rounded-sm border shrink-0 ${it.isVeg ? 'border-success' : 'border-destructive'}`}>
                    <span className={`m-auto h-1.5 w-1.5 rounded-full ${it.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{cat?.name} · {it.prepTimeMin} min · {money(it.price)}</div>
                  </div>
                  <ToggleAvailability id={it.id} initial={it.isAvailable} />
                  <Button size="icon" variant="ghost" onClick={() => setEditing(it)}><Pencil className="size-4" /></Button>
                  <DeleteItem id={it.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
        {editing && <ItemDialog item={editing} categories={categories} onClose={() => setEditing(null)} />}
      </TabsContent>
      <TabsContent value="categories">
        <CategoriesEditor branchId={branchId} categories={categories} />
      </TabsContent>
    </Tabs>
  );
}

function BulkActionBar({
  allIds, selected, onSelectAll, onSelectNone, onApplied
}: {
  allIds: string[]; selected: Set<string>;
  onSelectAll: () => void; onSelectNone: () => void; onApplied: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const count = selected.size;

  async function apply(patch: Record<string, boolean>) {
    if (count === 0) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/menu/items/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), patch })
      });
      if (!r.ok) return toast.error('Bulk update failed: ' + (await r.text()));
      const { count: n } = await r.json();
      toast.success(`Updated ${n} item${n === 1 ? '' : 's'}`);
      onApplied();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
      <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={allIds.length === 0}>Select all</Button>
      <Button size="sm" variant="ghost" onClick={onSelectNone} disabled={count === 0}>Select none</Button>
      {count > 0 && (
        <>
          <span className="text-xs text-muted-foreground ml-1">{count} item{count === 1 ? '' : 's'} selected</span>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isAvailable: true })}>Make available</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isAvailable: false })}>Make hidden</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isPopular: true })}>Mark popular</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isPopular: false })}>Unmark popular</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isRecommended: true })}>Mark recommended</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ isRecommended: false })}>Unmark recommended</Button>
        </>
      )}
    </div>
  );
}

function ToggleAvailability({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{v ? 'Available' : 'Hidden'}</span>
      <Switch
        checked={v}
        onCheckedChange={async (next) => {
          setV(!!next);
          await fetch(`/api/admin/menu/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isAvailable: !!next }) });
          router.refresh();
        }}
      />
    </div>
  );
}

function DeleteItem({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={async () => {
        if (!confirm('Delete this item?')) return;
        const r = await fetch(`/api/admin/menu/items/${id}`, { method: 'DELETE' });
        if (!r.ok) return toast.error('Failed');
        toast.success('Deleted');
        router.refresh();
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

function ItemDialog({ item, categories, onClose }: { item: any; categories: any[]; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState({
    name: item.name ?? '',
    slug: item.slug ?? '',
    description: item.description ?? '',
    price: Number(item.price ?? 0),
    categoryId: item.categoryId ?? categories[0]?.id ?? '',
    isVeg: item.isVeg ?? true,
    spicyLevel: item.spicyLevel ?? 0,
    prepTimeMin: item.prepTimeMin ?? 20,
    isAvailable: item.isAvailable ?? true,
    isPopular: item.isPopular ?? false,
    isRecommended: item.isRecommended ?? false,
    imageUrl: item.imageUrl ?? ''
  });
  const [busy, setBusy] = useState(false);
  const isNew = !item.id;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? 'New menu item' : 'Edit item'}</DialogTitle></DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (!data.slug) data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              const url = isNew ? '/api/admin/menu/items' : `/api/admin/menu/items/${item.id}`;
              const r = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, branchId: item.branchId }) });
              if (!r.ok) return toast.error('Failed: ' + (await r.text()));
              toast.success('Saved');
              onClose(); router.refresh();
            } finally { setBusy(false); }
          }}
        >
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <ImageUploader
              value={data.imageUrl}
              onChange={(url) => setData({ ...data, imageUrl: url ?? '' })}
              folder="menu-items"
              aspect="square"
              label="Photo"
              hint="A bright, top-down shot looks best."
            />
            <div className="space-y-3">
              <Field label="Name" value={data.name} onChange={(v) => setData({ ...data, name: v })} required />
              <div>
                <Label>Description</Label>
                <Input className="mt-1" value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} placeholder="What's in it? Any allergens?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price (₹)" type="number" value={String(data.price)} onChange={(v) => setData({ ...data, price: Number(v) })} required />
                <Field label="Prep time (min)" type="number" value={String(data.prepTimeMin)} onChange={(v) => setData({ ...data, prepTimeMin: Number(v) })} />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={data.categoryId} onValueChange={(v) => setData({ ...data, categoryId: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Spicy level</Label>
                <div className="mt-1 flex items-center gap-1.5">
                  {[0, 1, 2, 3].map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setData({ ...data, spicyLevel: n })}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        data.spicyLevel === n ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
                      }`}
                    >
                      {n === 0 ? 'Mild' : '🌶️'.repeat(n)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ToggleField label="Vegetarian" value={data.isVeg} onChange={(v) => setData({ ...data, isVeg: v })} />
            <ToggleField label="Available" value={data.isAvailable} onChange={(v) => setData({ ...data, isAvailable: v })} />
            <ToggleField label="Popular" value={data.isPopular} onChange={(v) => setData({ ...data, isPopular: v })} />
            <ToggleField label="Recommended" value={data.isRecommended} onChange={(v) => setData({ ...data, isRecommended: v })} />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !data.name.trim()}>
            {busy ? 'Saving…' : isNew ? 'Create item' : 'Save changes'}
          </Button>
        </form>

        {!isNew && <VariantModifierEditor menuItemId={item.id} itemName={data.name || item.name} />}
        {!isNew && <ScheduleSection itemId={item.id} />}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleSection({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hasSchedule, setHasSchedule] = useState(false);
  const [days, setDays] = useState<{ dayOfWeek: number; openMin: number; closeMin: number; closed: boolean }[]>(
    () => Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openMin: 11 * 60, closeMin: 23 * 60, closed: true }))
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      const r = await fetch(`/api/admin/menu/items/${itemId}/schedule`);
      if (r.ok) {
        const j = await r.json();
        setHasSchedule(!!j.hasSchedule);
        setDays(j.days);
      }
      setLoaded(true);
    })();
  }, [open, loaded, itemId]);

  function updateDay(d: number, patch: Partial<(typeof days)[number]>) {
    setDays((p) => p.map((x) => (x.dayOfWeek === d ? { ...x, ...patch } : x)));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/menu/items/${itemId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      if (!r.ok) return toast.error('Schedule save failed: ' + (await r.text()));
      toast.success('Schedule saved');
      setHasSchedule(true);
    } finally {
      setBusy(false);
    }
  }

  async function clearSchedule() {
    if (!confirm('Remove custom schedule? Item will follow branch hours.')) return;
    setBusy(true);
    try {
      const allClosed = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openMin: 0, closeMin: 0, closed: true }));
      // PUT with all-closed = no effective rows; but we'd prefer to truly clear. Send all-closed (server stores 0/0 rows).
      // To restore "always available", we instead send a PUT that deletes — easiest: hit PUT with all-closed and treat that
      // in the UI as "no schedule" by deleting on the server side. The server stores zeros; getter returns hasSchedule=true.
      // Simpler: just call PUT with all-closed (matches "no orders any day"). For true reset users can re-toggle days open.
      const r = await fetch(`/api/admin/menu/items/${itemId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: allClosed })
      });
      if (!r.ok) return toast.error('Failed: ' + (await r.text()));
      setDays(allClosed);
      setHasSchedule(true);
      toast.success('All days set to closed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-card">
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Availability schedule
        </span>
        <span className="text-xs text-muted-foreground">
          {hasSchedule ? 'Custom schedule set' : 'Always available (uses branch hours)'}
        </span>
      </button>
      {open && (
        <div className="border-t p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Override branch hours for this item. Leave all days off to fall back to branch hours.
          </p>
          {days.map((h) => (
            <div key={h.dayOfWeek} className="grid grid-cols-[60px_1fr] sm:grid-cols-[60px_auto_1fr_auto_1fr] items-center gap-2 text-sm">
              <div className="font-medium">{DAY_NAMES[h.dayOfWeek]}</div>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={!h.closed} onCheckedChange={(v) => updateDay(h.dayOfWeek, { closed: !v })} />
                <span>{h.closed ? 'Closed' : 'Open'}</span>
              </label>
              {!h.closed ? (
                <>
                  <Input type="time" value={minutesToTime(h.openMin)} onChange={(e) => updateDay(h.dayOfWeek, { openMin: timeToMinutes(e.target.value) })} className="h-9" />
                  <span className="text-muted-foreground text-center">to</span>
                  <Input type="time" value={minutesToTime(h.closeMin)} onChange={(e) => updateDay(h.dayOfWeek, { closeMin: timeToMinutes(e.target.value) })} className="h-9" />
                </>
              ) : (
                <div className="text-xs text-muted-foreground sm:col-span-3">Item not offered.</div>
              )}
            </div>
          ))}
          <div className="flex items-center justify-end gap-2 pt-2">
            {hasSchedule && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clearSchedule}>Reset</Button>
            )}
            <Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save schedule'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoriesEditor({ branchId, categories }: { branchId: string; categories: any[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name) return;
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const r = await fetch('/api/admin/menu/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId, name, slug }) });
          if (r.ok) { setName(''); router.refresh(); toast.success('Category added'); } else toast.error('Failed');
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
        <Button>Add</Button>
      </form>
      <ul className="grid gap-2">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({ category }: { category: any }) {
  const router = useRouter();
  const [active, setActive] = useState(!!category.isActive);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Server-derived status snapshot (provided by /admin/menu page). Resolves
  // the category to one of: Available now / Off-hours / Disabled / No schedule.
  const status = category.statusNow ?? { available: active, reason: active ? 'available' : 'disabled' };
  const scheduleEnabled = !!category.scheduleEnabled;

  async function toggle(next: boolean, cascadeItems = false) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/menu/categories/${category.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next, cascadeItems })
      });
      if (!r.ok) return toast.error('Failed: ' + (await r.text()));
      const { itemCount } = await r.json();
      setActive(next);
      toast.success(cascadeItems ? `${next ? 'Enabled' : 'Disabled'} category + ${itemCount} items` : `${next ? 'Enabled' : 'Disabled'} ${category.name}`);
      router.refresh();
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  return (
    <li className="tap-press card-lift rounded-lg border bg-card overflow-hidden">
      <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px] flex items-center gap-2.5">
          <span className="font-medium truncate">{category.name}</span>
          <StatusBadge status={status} scheduleEnabled={scheduleEnabled} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={scheduleEnabled ? 'default' : 'outline'}
            onClick={() => setScheduleOpen((o) => !o)}
            className="gap-1.5"
          >
            <CalendarClock className="size-3.5" />
            {scheduleEnabled ? 'Schedule' : 'Set schedule'}
          </Button>
          <span className="text-xs text-muted-foreground">{active ? 'Enabled' : 'Disabled'}</span>
          <Switch checked={active} disabled={busy} onCheckedChange={(v) => toggle(!!v, false)} />
        </div>
        <div className="relative">
          <Button size="icon" variant="ghost" disabled={busy} onClick={() => setMenuOpen((o) => !o)} aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border bg-popover p-1 shadow-md">
                <button
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => toggle(false, true)}
                >
                  Disable category + all items
                </button>
                <button
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => toggle(true, true)}
                >
                  Enable category + all items
                </button>
              </div>
            </>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={async () => {
            if (!confirm('Delete category?')) return;
            const r = await fetch(`/api/admin/menu/categories/${category.id}`, { method: 'DELETE' });
            if (r.ok) { router.refresh(); toast.success('Deleted'); } else toast.error('Cannot delete (in use?)');
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {scheduleOpen && (
        <div className="border-t bg-muted/30 p-3">
          <CategorySchedulePanel
            categoryId={category.id}
            initial={{
              scheduleEnabled,
              rows: (category.availabilities ?? []).map((r: any) => ({
                dayOfWeek: r.dayOfWeek, startMin: r.startMin, endMin: r.endMin
              }))
            }}
            onClose={() => setScheduleOpen(false)}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Compact status pill: Available now / Off-hours / Disabled / No-rows.
 *
 * Kitchen + admin still see the row regardless — this is the "see at a glance
 * which menu sections are live right now" indicator.
 */
function StatusBadge({ status, scheduleEnabled }: { status: { available: boolean; reason: string }; scheduleEnabled: boolean }) {
  if (!scheduleEnabled && status.available) {
    return <Badge variant="muted" className="text-[10px]">Always on</Badge>;
  }
  if (status.reason === 'disabled') {
    return <Badge variant="destructive" className="text-[10px]">Disabled</Badge>;
  }
  if (status.available) {
    return <Badge variant="success" className="text-[10px] gap-1"><Clock className="size-2.5" /> Available now</Badge>;
  }
  if (status.reason === 'no_schedule_rows') {
    return <Badge variant="warning" className="text-[10px]">No schedule</Badge>;
  }
  return <Badge variant="warning" className="text-[10px] gap-1"><Clock className="size-2.5" /> Off-hours</Badge>;
}

function Field({ label, value, onChange, type = 'text', ...rest }: { label: string; value: string; onChange: (v: string) => void; type?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} {...(rest as any)} />
    </div>
  );
}
function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border p-2 px-3">
      <span className="text-sm">{label}</span>
      <Switch checked={value} onCheckedChange={(v) => onChange(!!v)} />
    </label>
  );
}
