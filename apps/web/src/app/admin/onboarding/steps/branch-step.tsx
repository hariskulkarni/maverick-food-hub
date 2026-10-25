'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Loader2, MapPin, PauseCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { validateIndiaLatLng, validateIndianPhone, validatePinCode, parseLatLngInput } from '@/lib/onboarding/validators';
import { StepFrame, Field, apiJson, useDebouncedSave, minutesToTime, timeToMinutes } from '../parts';
import type { StepProps } from '../wizard-client';
import type { OnbBranch } from '../types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
interface Day { dayOfWeek: number; openMin: number; closeMin: number; closed: boolean }
interface BranchForm {
  name: string; line1: string; city: string; state: string; postalCode: string; phone: string;
  lat: string; lng: string; hours: Day[];
}

function toDays(b: OnbBranch | undefined): Day[] {
  return Array.from({ length: 7 }, (_, d) => {
    const h = b?.hours.find((x) => x.dayOfWeek === d);
    if (!h) return { dayOfWeek: d, openMin: 11 * 60, closeMin: 23 * 60, closed: false };
    // Same convention as server/operating-hours.ts: 0/0 = closed; closeMin < openMin = overnight.
    const closed = h.openMin === 0 && h.closeMin === 0;
    return { dayOfWeek: d, openMin: closed ? 11 * 60 : h.openMin, closeMin: closed ? 23 * 60 : h.closeMin, closed };
  });
}

export function BranchStep({ data, draft, saveDraft, complete, refresh }: StepProps) {
  const active = data.branches.filter((b) => b.isActive);
  const [branchId, setBranchId] = useState<string | null>(active[0]?.id ?? null);
  const branch = active.find((b) => b.id === branchId);
  const fromBranch = (b: OnbBranch | undefined): BranchForm => ({
    name: b?.name ?? 'Main branch', line1: b?.line1 ?? '', city: b?.city ?? '', state: b?.state ?? '',
    postalCode: b?.postalCode ?? '', phone: b?.phone ?? '',
    lat: b?.latitude != null ? String(b.latitude) : '', lng: b?.longitude != null ? String(b.longitude) : '',
    hours: toDays(b),
  });
  const d = draft as (BranchForm & { branchId?: string | null }) | undefined;
  const [f, setF] = useState<BranchForm>(d && d.branchId === branchId ? { ...fromBranch(branch), ...d } : fromBranch(branch));
  const [paste, setPaste] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useDebouncedSave({ ...f, branchId }, saveDraft);

  const lat = f.lat.trim() === '' ? null : Number(f.lat);
  const lng = f.lng.trim() === '' ? null : Number(f.lng);
  const errors = useMemo(() => ({
    line1: f.line1.trim().length < 3 ? 'Enter the street address (building, street, area).' : null,
    city: f.city.trim() ? null : 'City is required.',
    postalCode: validatePinCode(f.postalCode),
    phone: validateIndianPhone(f.phone),
    coords: validateIndiaLatLng(lat, lng),
    hours: f.hours.every((h) => h.closed) ? 'You are closed every day — open at least one day so customers can order.'
      : f.hours.some((h) => !h.closed && h.closeMin === h.openMin) ? 'Opening and closing time can\'t be the same — switch the day off if you are closed.'
      : null,
  }), [f, lat, lng]);
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const setDay = (d: number, patch: Partial<Day>) => setF((p) => ({ ...p, hours: p.hours.map((h) => (h.dayOfWeek === d ? { ...h, ...patch } : h)) }));
  const copyToAll = (d: number) => {
    const src = f.hours.find((h) => h.dayOfWeek === d)!;
    setF((p) => ({ ...p, hours: p.hours.map((h) => ({ ...h, openMin: src.openMin, closeMin: src.closeMin, closed: src.closed })) }));
    toast.success(`${DAYS[d]}'s hours copied to every day`);
  };
  const applyPreset = (kind: 'all' | 'monday-off' | 'lunch-dinner-late') => {
    setF((p) => ({
      ...p,
      hours: p.hours.map((h) => kind === 'all' ? { ...h, openMin: 660, closeMin: 1380, closed: false }
        : kind === 'monday-off' ? { ...h, openMin: 660, closeMin: 1380, closed: h.dayOfWeek === 1 }
        : { ...h, openMin: 720, closeMin: h.dayOfWeek === 5 || h.dayOfWeek === 6 ? 60 : 1380, closed: false }),
    }));
  };
  const applyPaste = () => {
    const p = parseLatLngInput(paste);
    if (!p) { toast.error('Could not find coordinates — paste something like "12.9352, 77.6245".'); return; }
    setF((x) => ({ ...x, lat: String(p.lat), lng: String(p.lng) }));
    setPaste('');
  };

  async function save() {
    setTouched(true);
    if (hasErrors) { toast.error('Fix the highlighted fields first.'); return; }
    setBusy(true);
    let id = branchId;
    if (!id) {
      const created = await apiJson<{ id: string }>('/api/admin/branches', 'POST', {
        name: f.name, line1: f.line1, city: f.city, state: f.state || undefined, postalCode: f.postalCode, phone: f.phone || undefined,
      }, 'Could not create your branch');
      if (!created) { setBusy(false); return; }
      id = created.id;
      setBranchId(id);
    }
    const ok = await apiJson(`/api/admin/settings/branch/${id}`, 'PATCH', {
      ...(branchId ? { name: f.name } : {}),
      line1: f.line1, city: f.city, state: f.state, postalCode: f.postalCode, phone: f.phone,
      latitude: lat, longitude: lng,
      hours: f.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: h.openMin, closeMin: h.closeMin, closed: h.closed })),
    }, 'Could not save branch details');
    setBusy(false);
    if (ok) {
      toast.success('Branch and hours saved');
      refresh();
      await complete();
    }
  }

  const mapsQuery = encodeURIComponent([f.line1, f.city, f.postalCode].filter(Boolean).join(' '));

  return (
    <StepFrame
      title="Branch & opening hours"
      intro="Tell us where you cook and when you take orders. The map pin is used to measure delivery distance, so drop it on your kitchen's entrance, not the area centre."
      why="Riders navigate to your pin, delivery fees are measured from it, and customers can only place orders during your opening hours."
      example={<>“12, 80 Feet Road, Koramangala 4th Block, Bengaluru 560034 · pin 12.9352, 77.6245”. Hours: 11:00–23:00 every day, <b>closed on Mondays</b> as a weekly holiday. For one-off holidays like Diwali, use <b>Pause orders → Until I resume</b> on the Orders screen that morning.</>}
    >
      {active.length > 1 && (
        <Field label="Branch">
          <select value={branchId ?? ''} onChange={(e) => { const b = active.find((x) => x.id === e.target.value); setBranchId(e.target.value); setF(fromBranch(b)); }} className="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm">
            {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
      {!branchId && <p className="rounded-lg border border-dashed p-3 text-sm">You don&apos;t have a branch yet — fill this in and we&apos;ll create your first one.</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch name" hint="Usually the area, e.g. Koramangala">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Koramangala" />
        </Field>
        <Field label="Branch phone" error={show('phone')} hint="Optional — if different from your main number.">
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 80 4123 4567" />
        </Field>
        <Field label="Street address" required error={show('line1')} className="sm:col-span-2">
          <Input value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} placeholder="12, 80 Feet Road, Koramangala 4th Block" />
        </Field>
        <Field label="City" required error={show('city')}>
          <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Bengaluru" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="State"><Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} placeholder="Karnataka" /></Field>
          <Field label="PIN code" required error={show('postalCode')}><Input inputMode="numeric" maxLength={6} value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} placeholder="560034" /></Field>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium text-sm"><MapPin className="size-4 text-primary" /> Map pin</div>
          <a href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Open Google Maps <ExternalLink className="size-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">In Google Maps, long-press (phone) or right-click (computer) your entrance, copy the numbers shown, and paste them here.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste e.g. 12.9352, 77.6245 or a Maps link" />
          <Button type="button" variant="outline" onClick={applyPaste}>Use these</Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude"><Input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="12.9352" /></Field>
          <Field label="Longitude"><Input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} placeholder="77.6245" /></Field>
        </div>
        {show('coords') && <p className="text-[11px] text-destructive">{errors.coords}</p>}
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium text-sm">Opening hours</div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('all')}>11:00–23:00 daily</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('monday-off')}>Closed Mondays</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('lunch-dinner-late')}>Till 1 am Fri & Sat</Button>
          </div>
        </div>
        <ul className="divide-y">
          {f.hours.map((h) => (
            <li key={h.dayOfWeek} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
              <span className="w-24 text-sm font-medium">{DAYS[h.dayOfWeek]}</span>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={!h.closed} onCheckedChange={(v) => setDay(h.dayOfWeek, { closed: !v })} aria-label={`${DAYS[h.dayOfWeek]} open`} />
                <span className="w-12">{h.closed ? 'Closed' : 'Open'}</span>
              </label>
              {!h.closed && (
                <div className="flex items-center gap-2">
                  <Input type="time" aria-label="Opens" value={minutesToTime(h.openMin)} onChange={(e) => setDay(h.dayOfWeek, { openMin: timeToMinutes(e.target.value) })} className="h-9 w-[7.5rem]" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="time" aria-label="Closes" value={minutesToTime(h.closeMin)} onChange={(e) => setDay(h.dayOfWeek, { closeMin: timeToMinutes(e.target.value) })} className="h-9 w-[7.5rem]" />
                  {h.closeMin < h.openMin && <span className="text-[11px] text-muted-foreground">(closes next day)</span>}
                </div>
              )}
              <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => copyToAll(h.dayOfWeek)} title="Copy to all days">
                <Copy className="size-3.5" /> <span className="hidden sm:inline">Copy to all days</span>
              </Button>
            </li>
          ))}
        </ul>
        {show('hours') && <p className="text-[11px] text-destructive">{errors.hours}</p>}
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <PauseCircle className="size-3.5 shrink-0 mt-px" /> One opening window per day; a closing time earlier than the opening time runs past midnight (e.g. 18:00–02:00). Festival closure or running late? Pause orders from the Orders screen instead of changing your weekly hours.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {branchId ? 'Save & continue' : 'Create branch & continue'}</Button>
      </div>
    </StepFrame>
  );
}
