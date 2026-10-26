'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { reportApiError } from '@/lib/api-error';
import { toast } from 'sonner';
import { Plus, Trash2, X } from 'lucide-react';
import type { CircleValue, LngLat } from './zone-map-editor';

// Leaflet touches `window`; load the map client-only.
const ZoneMapEditor = dynamic(() => import('./zone-map-editor').then((m) => m.ZoneMapEditor), {
  ssr: false,
  loading: () => <div className="h-[320px] w-full animate-pulse rounded-lg border bg-muted/40" />,
});

type ZoneType = 'POLYGON' | 'CIRCLE' | 'PINCODE';

/** Shape returned by GET /api/admin/delivery-zones (Prisma row as JSON; Decimal -> string). */
export interface ZoneRow {
  id: string;
  branchId: string;
  name: string;
  type: ZoneType;
  priority: number;
  isActive: boolean;
  isDefault: boolean;
  polygon: LngLat[] | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  pincodes: string[];
  feeBrackets: { minSubtotal: number; charge: number }[] | null;
  distanceTiers: { uptoKm: number; charge: number }[] | null;
  minOrder: string | number | null;
  etaMinutes: number | null;
}

// UI works in rupees; the API wants integer paise for brackets/tiers (charge -1 = unavailable).
interface BracketRow { minSubtotal: string; charge: string; unavailable: boolean }
interface TierRow { uptoKm: string; charge: string }

const toPaise = (rupees: string) => Math.round((Number(rupees) || 0) * 100);
const toRupees = (paise: number) => String(paise / 100);
const fieldCls = 'h-11';

export function ZoneForm({
  restaurantId, branchId, branchPoint, editing, onDone,
}: {
  restaurantId: string;
  branchId: string;
  branchPoint: { lat: number; lng: number } | null;
  editing: ZoneRow | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<ZoneType>(editing?.type ?? 'POLYGON');
  const [priority, setPriority] = useState(String(editing?.priority ?? 100));
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);
  const [polygon, setPolygon] = useState<LngLat[] | null>(editing?.polygon ?? null);
  const [circle, setCircle] = useState<CircleValue | null>(
    editing?.type === 'CIRCLE' && editing.centerLat != null && editing.centerLng != null && editing.radiusKm != null
      ? { lat: editing.centerLat, lng: editing.centerLng, radiusKm: editing.radiusKm }
      : null,
  );
  const [pincodes, setPincodes] = useState<string[]>(editing?.pincodes ?? []);
  const [pinDraft, setPinDraft] = useState('');
  const [brackets, setBrackets] = useState<BracketRow[]>(
    (editing?.feeBrackets ?? []).map((b) => ({
      minSubtotal: toRupees(b.minSubtotal), charge: b.charge < 0 ? '' : toRupees(b.charge), unavailable: b.charge < 0,
    })),
  );
  const [tiers, setTiers] = useState<TierRow[]>(
    (editing?.distanceTiers ?? []).map((t) => ({ uptoKm: String(t.uptoKm), charge: toRupees(t.charge) })),
  );
  const [minOrder, setMinOrder] = useState(editing?.minOrder != null ? String(Number(editing.minOrder)) : '');
  const [eta, setEta] = useState(editing?.etaMinutes != null ? String(editing.etaMinutes) : '');
  const [busy, setBusy] = useState(false);

  function addPin() {
    const parts = pinDraft.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    setPincodes((prev) => Array.from(new Set([...prev, ...parts])));
    setPinDraft('');
  }

  const shapeOk =
    type === 'POLYGON' ? !!polygon && polygon.length >= 3
    : type === 'CIRCLE' ? !!circle && circle.radiusKm > 0
    : pincodes.length > 0;

  async function save() {
    setBusy(true);
    try {
      const body = {
        branchId,
        name: name.trim(),
        type,
        priority: Math.max(0, Math.round(Number(priority) || 0)),
        isActive,
        isDefault,
        polygon: type === 'POLYGON' ? polygon : null,
        centerLat: type === 'CIRCLE' ? circle?.lat ?? null : null,
        centerLng: type === 'CIRCLE' ? circle?.lng ?? null : null,
        radiusKm: type === 'CIRCLE' ? circle?.radiusKm ?? null : null,
        pincodes: type === 'PINCODE' ? pincodes : [],
        feeBrackets: brackets.map((b) => ({ minSubtotal: toPaise(b.minSubtotal), charge: b.unavailable ? -1 : toPaise(b.charge) })),
        distanceTiers: tiers
          .filter((t) => Number(t.uptoKm) > 0)
          .map((t) => ({ uptoKm: Number(t.uptoKm), charge: toPaise(t.charge) })),
        minOrder: minOrder.trim() === '' ? null : Number(minOrder),   // rupees
        etaMinutes: eta.trim() === '' ? null : Math.round(Number(eta)),
      };
      const qs = `?restaurantId=${encodeURIComponent(restaurantId)}`;
      const res = editing
        ? await fetch(`/api/admin/delivery-zones/${editing.id}${qs}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/delivery-zones${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { await reportApiError(res, 'Save failed'); return; }
      toast.success(editing ? 'Zone updated' : 'Zone created');
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="z-name" className="text-xs font-medium text-muted-foreground">Zone name</Label>
          <Input id="z-name" className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Inner city" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="z-type" className="text-xs font-medium text-muted-foreground">Zone type</Label>
          <select
            id="z-type"
            value={type}
            onChange={(e) => setType(e.target.value as ZoneType)}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="POLYGON">Polygon (draw on map)</option>
            <option value="CIRCLE">Circle (radius)</option>
            <option value="PINCODE">Pincodes</option>
          </select>
        </div>
      </div>

      {type === 'PINCODE' ? (
        <div className="space-y-2">
          <Label htmlFor="z-pin" className="text-xs font-medium text-muted-foreground">Pincodes</Label>
          <div className="flex gap-2">
            <Input
              id="z-pin" className={fieldCls} value={pinDraft} inputMode="numeric" placeholder="522001, 522002"
              onChange={(e) => setPinDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPin(); } }}
            />
            <Button type="button" variant="outline" className="h-11" onClick={addPin}><Plus className="size-4" /> Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {pincodes.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-sm text-primary">
                {p}
                <button
                  type="button" aria-label={`Remove ${p}`}
                  className="grid size-11 -my-3 place-items-center rounded-full hover:bg-primary/20"
                  onClick={() => setPincodes((prev) => prev.filter((x) => x !== p))}
                >
                  <X className="size-4" />
                </button>
              </span>
            ))}
            {pincodes.length === 0 && <span className="text-xs text-muted-foreground">No pincodes added yet.</span>}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <ZoneMapEditor
            key={type}
            mode={type}
            polygon={polygon}
            circle={circle}
            branchPoint={branchPoint}
            onPolygon={setPolygon}
            onCircle={setCircle}
          />
          <p className="text-xs text-muted-foreground">
            {type === 'POLYGON'
              ? polygon ? `${polygon.length} points set.` : 'No shape drawn yet.'
              : circle ? `Radius ${circle.radiusKm.toFixed(2)} km around ${circle.lat.toFixed(4)}, ${circle.lng.toFixed(4)}.` : 'No circle drawn yet.'}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="z-prio" className="text-xs font-medium text-muted-foreground">Priority (lower wins)</Label>
          <Input id="z-prio" className={fieldCls} type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="z-min" className="text-xs font-medium text-muted-foreground">Min order (₹)</Label>
          <Input id="z-min" className={fieldCls} type="number" min={0} step="1" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="None" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="z-eta" className="text-xs font-medium text-muted-foreground">ETA override (min)</Label>
          <Input id="z-eta" className={fieldCls} type="number" min={1} max={1440} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="Auto" />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
          <span className="text-sm">Active</span>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
          <span className="text-sm">Default zone (fallback)</span>
          <Switch checked={isDefault} onCheckedChange={setIsDefault} />
        </label>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Fee brackets</h3>
            <p className="text-xs text-muted-foreground">Delivery charge by cart subtotal (₹). Highest matching minimum applies.</p>
          </div>
          <Button type="button" variant="outline" className="h-11"
            onClick={() => setBrackets((r) => [...r, { minSubtotal: '', charge: '', unavailable: false }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {brackets.length === 0 && (
          <p className={editing ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
            {editing
              ? 'Add at least one fee bracket. A zone without fee brackets refuses every delivery.'
              : 'No brackets added: the zone will start with one bracket (from ₹0) charging the branch base delivery fee. You can edit it later.'}
          </p>
        )}
        {brackets.map((b, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
            <div className="min-w-0 flex-1 basis-28 space-y-1">
              <Label className="text-xs text-muted-foreground">Subtotal from (₹)</Label>
              <Input className={fieldCls} type="number" min={0} value={b.minSubtotal}
                onChange={(e) => setBrackets((r) => r.map((x, j) => (j === i ? { ...x, minSubtotal: e.target.value } : x)))} />
            </div>
            <div className="min-w-0 flex-1 basis-28 space-y-1">
              <Label className="text-xs text-muted-foreground">Charge (₹, 0 = free)</Label>
              <Input className={fieldCls} type="number" min={0} value={b.charge} disabled={b.unavailable}
                onChange={(e) => setBrackets((r) => r.map((x, j) => (j === i ? { ...x, charge: e.target.value } : x)))} />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <Switch checked={b.unavailable}
                onCheckedChange={(v) => setBrackets((r) => r.map((x, j) => (j === i ? { ...x, unavailable: v } : x)))} />
              Unavailable
            </label>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Remove bracket"
              onClick={() => setBrackets((r) => r.filter((_, j) => j !== i))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Distance tiers</h3>
            <p className="text-xs text-muted-foreground">Delivery charge by distance from the branch (₹, up to the km given).</p>
          </div>
          <Button type="button" variant="outline" className="h-11"
            onClick={() => setTiers((r) => [...r, { uptoKm: '', charge: '' }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {tiers.map((t, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
            <div className="min-w-0 flex-1 basis-28 space-y-1">
              <Label className="text-xs text-muted-foreground">Up to (km)</Label>
              <Input className={fieldCls} type="number" min={0} step="0.1" value={t.uptoKm}
                onChange={(e) => setTiers((r) => r.map((x, j) => (j === i ? { ...x, uptoKm: e.target.value } : x)))} />
            </div>
            <div className="min-w-0 flex-1 basis-28 space-y-1">
              <Label className="text-xs text-muted-foreground">Charge (₹)</Label>
              <Input className={fieldCls} type="number" min={0} value={t.charge}
                onChange={(e) => setTiers((r) => r.map((x, j) => (j === i ? { ...x, charge: e.target.value } : x)))} />
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Remove tier"
              onClick={() => setTiers((r) => r.filter((_, j) => j !== i))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
      </section>

      <div className="flex justify-end gap-2">
        <Button className="h-11" onClick={save} disabled={busy || !name.trim() || !shapeOk || (!!editing && brackets.length === 0)}>
          {busy ? 'Saving…' : editing ? 'Save zone' : 'Create zone'}
        </Button>
      </div>
    </div>
  );
}
