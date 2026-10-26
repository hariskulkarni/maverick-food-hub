'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Calculator, Loader2, MapPinned, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DELIVERY_PRESETS, presetToZoneBody, previewFee, validatePreset, type PresetValues } from '@/lib/onboarding/delivery-presets';
import { StepFrame, Field, apiJson } from '../parts';
import type { StepProps } from '../wizard-client';
import type { OnbZone } from '../types';

function zoneSummary(z: OnbZone): string {
  const brackets = Array.isArray(z.feeBrackets) ? (z.feeBrackets as { minSubtotal: number; charge: number }[]) : [];
  const tiers = Array.isArray(z.distanceTiers) ? (z.distanceTiers as { uptoKm: number; charge: number }[]) : [];
  const parts: string[] = [];
  if (z.radiusKm) parts.push(`${z.radiusKm} km`);
  const base = brackets.find((b) => b.minSubtotal === 0);
  if (base) parts.push(base.charge < 0 ? 'no delivery' : base.charge === 0 ? 'free base' : `₹${base.charge / 100} base`);
  const free = brackets.find((b) => b.minSubtotal > 0 && b.charge === 0);
  if (free) parts.push(`free above ₹${free.minSubtotal / 100}`);
  if (tiers.length) parts.push(tiers.map((t) => `≤${t.uptoKm} km +₹${t.charge / 100}`).join(', '));
  if (z.minOrder) parts.push(`min ₹${z.minOrder}`);
  return parts.join(' · ');
}

export function DeliveryStep({ data, complete, refresh, goTo }: StepProps) {
  const active = data.branches.filter((b) => b.isActive);
  const [branchId, setBranchId] = useState(active[0]?.id ?? '');
  const branch = active.find((b) => b.id === branchId);
  const [presetId, setPresetId] = useState<string>(DELIVERY_PRESETS[0]!.id);
  const [v, setV] = useState<PresetValues>(DELIVERY_PRESETS[0]!.values);
  const [name, setName] = useState(DELIVERY_PRESETS[0]!.title);
  const [calc, setCalc] = useState({ km: '2.5', subtotal: '350' });
  const [busy, setBusy] = useState(false);
  const problems = useMemo(() => validatePreset(v), [v]);
  const preview = previewFee(v, Number(calc.km) || 0, Number(calc.subtotal) || 0);
  const deliveryOk = data.readiness.checks.find((c) => c.key === 'delivery')?.ok ?? false;
  const hasPin = branch?.latitude != null && branch?.longitude != null;

  const pick = (id: string) => {
    const p = DELIVERY_PRESETS.find((x) => x.id === id)!;
    setPresetId(id); setV(p.values); setName(p.title);
  };

  async function create() {
    if (!branch || !hasPin) return;
    if (problems.length) { toast.error(problems[0]!); return; }
    setBusy(true);
    const res = await apiJson('/api/admin/delivery-zones', 'POST', presetToZoneBody(v, { id: branch.id, latitude: branch.latitude!, longitude: branch.longitude! }, name.trim() || 'Delivery zone'), 'Could not create the zone');
    setBusy(false);
    if (res) { toast.success('Delivery zone created'); refresh(); }
  }

  async function remove(id: string) {
    const r = await fetch(`/api/admin/delivery-zones/${id}`, { method: 'DELETE' });
    if (r.ok) { toast.success('Zone removed'); refresh(); } else toast.error('Could not remove the zone');
  }

  if (active.length === 0) {
    return (
      <StepFrame title="Delivery zones & fees" intro="Add your branch first — zones are drawn around it." why="Delivery distance and fees are measured from your branch's map pin.">
        <Button variant="outline" onClick={() => goTo('branches')}>Go to Branch & hours</Button>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      title="Delivery zones & fees"
      intro="Decide how far you deliver and what customers pay. Start from a preset, tweak the numbers, and check the calculator before saving."
      why="Orders from outside every zone are blocked at checkout, so customers never order food you can't deliver. Fees are shown before they pay — no surprises, fewer cancellations."
      example={<>With <b>distance slabs</b> (₹20 ≤ 2 km, ₹35 ≤ 5 km, ₹50 ≤ 8 km), a customer 4.2 km away ordering ₹350 pays <b>₹35</b> delivery. With <b>free above ₹499</b>, a ₹520 order delivers free.</>}
    >
      {active.length > 1 && (
        <Field label="Branch">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm">
            {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}

      <div className="rounded-xl border p-4 space-y-2">
        <div className="text-sm font-medium flex items-center gap-2"><MapPinned className="size-4 text-primary" /> Zones for {branch?.name}</div>
        {branch && branch.zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No zones yet.{hasPin ? ` Until you add one, delivery uses your basic ${branch.serviceRadiusKm} km radius at ₹${branch.baseDeliveryFee} + ₹${branch.perKmDeliveryFee} per km after the first.` : ''}
          </p>
        ) : (
          <ul className="divide-y">
            {branch?.zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{z.name} {!z.isActive && <Badge variant="muted">Off</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{zoneSummary(z)}</div>
                </div>
                <Button size="icon" variant="ghost" aria-label={`Remove ${z.name}`} onClick={() => remove(z.id)}><Trash2 className="size-4 text-destructive" /></Button>
              </li>
            ))}
          </ul>
        )}
        <a href="/admin/delivery-zones" className="text-xs text-primary hover:underline">Draw custom shapes or PIN-code zones on the map editor</a>
      </div>

      {!hasPin ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          This branch has no map pin yet, so we can&apos;t draw a zone around it.{' '}
          <button type="button" className="text-primary underline" onClick={() => goTo('branches')}>Add the pin</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {DELIVERY_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p.id)}
                className={cn('rounded-xl border p-3 text-left', presetId === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent')}>
                <div className="text-sm font-semibold">{p.title}</div>
                <div className="text-xs text-muted-foreground">{p.summary}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Zone name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Radius (km)"><Input inputMode="decimal" value={v.radiusKm} onChange={(e) => setV({ ...v, radiusKm: Number(e.target.value) })} /></Field>
            <Field label="Base delivery fee (₹)" hint="0 = free"><Input inputMode="decimal" value={v.baseFee} onChange={(e) => setV({ ...v, baseFee: Number(e.target.value) })} /></Field>
            <Field label="Free delivery above (₹)" hint="Leave blank for never"><Input inputMode="decimal" value={v.freeAbove ?? ''} onChange={(e) => setV({ ...v, freeAbove: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Minimum order (₹)" hint="Leave blank for none"><Input inputMode="decimal" value={v.minOrder ?? ''} onChange={(e) => setV({ ...v, minOrder: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Promised delivery time (min)"><Input inputMode="numeric" value={v.etaMinutes} onChange={(e) => setV({ ...v, etaMinutes: Number(e.target.value) })} /></Field>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium">Distance slabs <span className="font-normal text-muted-foreground">(added on top of the base fee)</span></div>
            {v.slabs.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span>Up to</span>
                <Input aria-label="Up to km" inputMode="decimal" value={s.uptoKm} onChange={(e) => setV({ ...v, slabs: v.slabs.map((x, j) => (j === i ? { ...x, uptoKm: Number(e.target.value) } : x)) })} className="h-9 w-20" />
                <span>km → ₹</span>
                <Input aria-label="Fee" inputMode="decimal" value={s.fee} onChange={(e) => setV({ ...v, slabs: v.slabs.map((x, j) => (j === i ? { ...x, fee: Number(e.target.value) } : x)) })} className="h-9 w-20" />
                <Button size="icon" variant="ghost" aria-label="Remove slab" onClick={() => setV({ ...v, slabs: v.slabs.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setV({ ...v, slabs: [...v.slabs, { uptoKm: v.radiusKm, fee: 20 }] })}><Plus className="size-4" /> Add slab</Button>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium"><Calculator className="size-4 text-primary" /> Try it</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>A customer</span>
              <Input aria-label="Distance km" inputMode="decimal" value={calc.km} onChange={(e) => setCalc({ ...calc, km: e.target.value })} className="h-9 w-20" />
              <span>km away ordering ₹</span>
              <Input aria-label="Order value" inputMode="decimal" value={calc.subtotal} onChange={(e) => setCalc({ ...calc, subtotal: e.target.value })} className="h-9 w-24" />
              <span>→</span>
              <span className="font-semibold">
                {preview == null ? 'is outside this zone' : `pays ₹${preview.fee} delivery${preview.belowMinimum ? ` (below the ₹${v.minOrder} minimum — can't order yet)` : ''}`}
              </span>
            </div>
          </div>

          {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="flex justify-end">
            <Button variant="outline" onClick={create} disabled={busy || problems.length > 0}>{busy && <Loader2 className="size-4 animate-spin" />} Create this zone</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {!deliveryOk && <span className="text-xs text-muted-foreground">Set a delivery area for every branch to continue.</span>}
        <Button onClick={complete} disabled={!deliveryOk}>Continue</Button>
      </div>
    </StepFrame>
  );
}
