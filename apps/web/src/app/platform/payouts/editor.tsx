'use client';
/**
 * Payout rule editor — comprehensive.
 *
 * Sections (collapsible):
 *   1. Identity (name, notes, schedule)
 *   2. Base & distance
 *   3. Time-based bonuses
 *   4. Conditions (rain, COD, order-value share)
 *   5. Performance & quality
 *   6. Wait time & cancellation
 *   7. Caps (floor / ceiling)
 *
 * Right rail: live calculator with 4 preset scenarios that re-runs against the
 * actual `computeFromRule` server function as you edit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Save, Calculator, ChevronDown, MapPin, Clock, CloudRain,
  Award, Timer, Gauge, Copy, RotateCcw, Sparkles, AlertCircle
} from 'lucide-react';

type RuleData = {
  name: string;
  notes: string;

  baseAmount: number;
  perKmAmount: number;
  firstKmIncluded: number;
  longDistanceThresholdKm: number;
  longDistanceBonusPerKm: number;

  perMinuteAmount: number;
  lunchPeakStartMin: number;
  lunchPeakEndMin: number;
  lunchPeakBonus: number;
  dinnerPeakStartMin: number;
  dinnerPeakEndMin: number;
  dinnerPeakBonus: number;
  lateNightStartMin: number;
  lateNightBonus: number;
  weekendBonus: number;

  rainBonus: number;
  codHandlingFee: number;
  orderValueSharePct: number;

  dailyTripBonusThreshold: number;
  dailyTripBonusAmount: number;
  weeklyTripBonusThreshold: number;
  weeklyTripBonusAmount: number;
  ratingBonusThreshold: number;
  ratingBonusAmount: number;

  waitTimeStartMin: number;
  waitTimePerMin: number;
  cancellationPayPct: number;

  minimumPerDelivery: number;
  maxPerDelivery: number;

  effectiveFrom: string;
  effectiveTo: string;
};

const DEFAULTS: RuleData = {
  name: 'Default v1',
  notes: '',
  baseAmount: 30, perKmAmount: 5, firstKmIncluded: 1,
  longDistanceThresholdKm: 5, longDistanceBonusPerKm: 0,
  perMinuteAmount: 0,
  lunchPeakStartMin: 720, lunchPeakEndMin: 870, lunchPeakBonus: 10,
  dinnerPeakStartMin: 1140, dinnerPeakEndMin: 1380, dinnerPeakBonus: 10,
  lateNightStartMin: 1320, lateNightBonus: 0,
  weekendBonus: 0,
  rainBonus: 15, codHandlingFee: 0, orderValueSharePct: 0,
  dailyTripBonusThreshold: 0, dailyTripBonusAmount: 0,
  weeklyTripBonusThreshold: 0, weeklyTripBonusAmount: 0,
  ratingBonusThreshold: 0, ratingBonusAmount: 0,
  waitTimeStartMin: 10, waitTimePerMin: 1, cancellationPayPct: 50,
  minimumPerDelivery: 0, maxPerDelivery: 0,
  effectiveFrom: '', effectiveTo: ''
};

function num(v: any, fallback = 0) { return v == null || v === '' ? fallback : Number(v); }
function minutesToTime(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function timeToMinutes(s: string) { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); }

export function PayoutRuleEditor({ current }: { current: any }) {
  const router = useRouter();
  const [data, setData] = useState<RuleData>(() => {
    const seed: RuleData = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof RuleData)[]) {
      if (k === 'effectiveFrom' || k === 'effectiveTo' || k === 'name' || k === 'notes') continue;
      if (current?.[k] != null) (seed as any)[k] = Number(current[k]);
    }
    seed.name = current?.name ?? DEFAULTS.name;
    seed.notes = current?.notes ?? '';
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ base: true, time: true, conditions: false, perf: false, wait: false, caps: false });

  function set<K extends keyof RuleData>(k: K, v: RuleData[K]) { setData((p) => ({ ...p, [k]: v })); }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/platform/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom).toISOString() : undefined,
          effectiveTo:   data.effectiveTo   ? new Date(data.effectiveTo).toISOString()   : null
        })
      });
      if (!r.ok) return toast.error('Save failed: ' + (await r.text()));
      toast.success('Saved — future deliveries use this rule.');
      router.refresh();
    } finally { setBusy(false); }
  }

  function reset() {
    if (!confirm('Reset all fields to defaults?')) return;
    setData({ ...DEFAULTS, name: data.name + ' (reset)' });
  }

  function cloneAsNew() {
    setData((p) => ({ ...p, name: p.name.replace(/\s*v?\d+$/, '') + ' v' + (Math.floor(Math.random() * 90) + 10), effectiveFrom: '', effectiveTo: '' }));
    toast.info('Cloned. Tweak and save to publish as a new active rule.');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Identity card */}
        <Card><CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Rule</h3>
              <p className="text-xs text-muted-foreground">Name this version. The active rule applies to every delivery claimed from the pool.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={cloneAsNew}><Copy className="size-3.5" /> Clone as new</Button>
              <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-3.5" /> Reset</Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Field label="Rule name *">
              <Input value={data.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Effective from">
              <Input type="datetime-local" value={data.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className="w-44" />
            </Field>
            <Field label="Expires at (optional)">
              <Input type="datetime-local" value={data.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} className="w-44" />
            </Field>
          </div>
          <Field label="Notes for your records">
            <Input value={data.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. monsoon-season surge, weekend Eid bonus…" />
          </Field>
        </CardContent></Card>

        {/* Base & distance */}
        <Section id="base" icon={MapPin} title="Base pay & distance" subtitle="Per-trip fixed + per-km. Distance is straight-line branch → delivery."
          open={open.base} toggle={() => setOpen({ ...open, base: !open.base })}>
          <div className="grid gap-3 md:grid-cols-3">
            <NumField label="Base ₹ per delivery" value={data.baseAmount} setValue={(v) => set('baseAmount', v)} prefix="₹" />
            <NumField label="First km included" value={data.firstKmIncluded} setValue={(v) => set('firstKmIncluded', v)} suffix="km" hint="Per-km pay starts after this." />
            <NumField label="₹ per km (after first)" value={data.perKmAmount} setValue={(v) => set('perKmAmount', v)} prefix="₹" />
            <NumField label="Long-distance threshold" value={data.longDistanceThresholdKm} setValue={(v) => set('longDistanceThresholdKm', v)} suffix="km" hint="Beyond this, the bonus rate kicks in." />
            <NumField label="Long-distance bonus ₹/km" value={data.longDistanceBonusPerKm} setValue={(v) => set('longDistanceBonusPerKm', v)} prefix="₹" />
            <NumField label="Per-active-minute pay" value={data.perMinuteAmount} setValue={(v) => set('perMinuteAmount', v)} prefix="₹" hint="Pickup-to-drop duration × ₹/min." />
          </div>
        </Section>

        {/* Time-based */}
        <Section id="time" icon={Clock} title="Time-of-day & week bonuses" subtitle="Lunch, dinner, late-night, weekend surges."
          open={open.time} toggle={() => setOpen({ ...open, time: !open.time })}>
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Lunch peak</div>
            <div className="grid grid-cols-3 gap-3">
              <TimeField label="Starts" value={data.lunchPeakStartMin} setValue={(v) => set('lunchPeakStartMin', v)} />
              <TimeField label="Ends" value={data.lunchPeakEndMin} setValue={(v) => set('lunchPeakEndMin', v)} />
              <NumField  label="Bonus" value={data.lunchPeakBonus} setValue={(v) => set('lunchPeakBonus', v)} prefix="₹" />
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Dinner peak</div>
            <div className="grid grid-cols-3 gap-3">
              <TimeField label="Starts" value={data.dinnerPeakStartMin} setValue={(v) => set('dinnerPeakStartMin', v)} />
              <TimeField label="Ends" value={data.dinnerPeakEndMin} setValue={(v) => set('dinnerPeakEndMin', v)} />
              <NumField  label="Bonus" value={data.dinnerPeakBonus} setValue={(v) => set('dinnerPeakBonus', v)} prefix="₹" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Late night (until 05:00)</div>
              <div className="grid grid-cols-2 gap-3">
                <TimeField label="Starts at" value={data.lateNightStartMin} setValue={(v) => set('lateNightStartMin', v)} />
                <NumField  label="Bonus"      value={data.lateNightBonus} setValue={(v) => set('lateNightBonus', v)} prefix="₹" />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Weekend (Sat + Sun)</div>
              <NumField label="Bonus per delivery" value={data.weekendBonus} setValue={(v) => set('weekendBonus', v)} prefix="₹" />
            </div>
          </div>
        </Section>

        {/* Conditions */}
        <Section id="conditions" icon={CloudRain} title="Conditions" subtitle="Rain surge, cash handling, share of order value."
          open={open.conditions} toggle={() => setOpen({ ...open, conditions: !open.conditions })}>
          <div className="grid gap-3 md:grid-cols-3">
            <NumField label="Rain bonus (manual surge)" value={data.rainBonus} setValue={(v) => set('rainBonus', v)} prefix="₹" hint="Apply by toggling Rain Mode in dispatch." />
            <NumField label="COD handling fee" value={data.codHandlingFee} setValue={(v) => set('codHandlingFee', v)} prefix="₹" hint="Paid extra when payment method is Cash." />
            <NumField label="Order-value share %" value={data.orderValueSharePct} setValue={(v) => set('orderValueSharePct', v)} suffix="%" hint="% of order subtotal added to rider pay." />
          </div>
        </Section>

        {/* Performance */}
        <Section id="perf" icon={Award} title="Performance & quality" subtitle="Daily/weekly milestones and rating bonus."
          open={open.perf} toggle={() => setOpen({ ...open, perf: !open.perf })}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Daily milestone</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="After N trips" value={data.dailyTripBonusThreshold} setValue={(v) => set('dailyTripBonusThreshold', v)} suffix="trips" />
                <NumField label="One-off bonus" value={data.dailyTripBonusAmount} setValue={(v) => set('dailyTripBonusAmount', v)} prefix="₹" />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Weekly milestone</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="After N trips" value={data.weeklyTripBonusThreshold} setValue={(v) => set('weeklyTripBonusThreshold', v)} suffix="trips" />
                <NumField label="One-off bonus" value={data.weeklyTripBonusAmount} setValue={(v) => set('weeklyTripBonusAmount', v)} prefix="₹" />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3 md:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Rating bonus</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Min average rating" value={data.ratingBonusThreshold} setValue={(v) => set('ratingBonusThreshold', v)} hint="0 = disabled. Use 4.5 for premium tier." />
                <NumField label="Bonus per delivery"  value={data.ratingBonusAmount} setValue={(v) => set('ratingBonusAmount', v)} prefix="₹" />
              </div>
            </div>
          </div>
        </Section>

        {/* Wait time + cancellation */}
        <Section id="wait" icon={Timer} title="Wait time & cancellation" subtitle="Pay riders for time spent waiting or short trips that cancel post-pickup."
          open={open.wait} toggle={() => setOpen({ ...open, wait: !open.wait })}>
          <div className="grid gap-3 md:grid-cols-3">
            <NumField label="Wait-time pay starts after" value={data.waitTimeStartMin} setValue={(v) => set('waitTimeStartMin', v)} suffix="min" />
            <NumField label="₹ per minute waiting"        value={data.waitTimePerMin}   setValue={(v) => set('waitTimePerMin', v)}   prefix="₹" />
            <NumField label="Cancellation pay (% of base)" value={data.cancellationPayPct} setValue={(v) => set('cancellationPayPct', v)} suffix="%" hint="Paid if customer cancels after rider picked up." />
          </div>
        </Section>

        {/* Caps */}
        <Section id="caps" icon={Gauge} title="Floor & ceiling" subtitle="Minimum guarantee per trip and an upper cap (fraud guard)."
          open={open.caps} toggle={() => setOpen({ ...open, caps: !open.caps })}>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField label="Minimum per delivery" value={data.minimumPerDelivery} setValue={(v) => set('minimumPerDelivery', v)} prefix="₹" hint="0 = no floor." />
            <NumField label="Maximum per delivery" value={data.maxPerDelivery}     setValue={(v) => set('maxPerDelivery', v)}     prefix="₹" hint="0 = uncapped." />
          </div>
        </Section>

        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            <strong>Heads up:</strong> Saving deactivates the previous rule and starts the new one. Past deliveries keep the payout that was active at claim time.
          </p>
          <Button onClick={save} disabled={busy || !data.name.trim()}>
            <Save className="size-4" /> {busy ? 'Saving…' : 'Save as new active rule'}
          </Button>
        </div>
      </div>

      {/* Live calculator (right rail on desktop, beneath on mobile) */}
      <LiveCalculator data={data} />
    </div>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────────
function Section({ id, icon: Icon, title, subtitle, open, toggle, children }: {
  id: string; icon: any; title: string; subtitle: string; open: boolean; toggle: () => void; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <button type="button" onClick={toggle} className="w-full flex items-center justify-between gap-3 p-5 text-left">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div>
            <div>
              <div className="font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            </div>
          </div>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <div className="p-5 pt-0 space-y-3">{children}</div>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{label}</Label>{children}</div>;
}

function NumField({ label, value, setValue, prefix, suffix, hint }: { label: string; value: number; setValue: (v: number) => void; prefix?: string; suffix?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
        <Input
          type="number" step="0.1" min={0}
          value={value === 0 ? '' : value}
          onChange={(e) => setValue(num(e.target.value, 0))}
          placeholder="0"
          className={`${prefix ? 'pl-7' : ''} ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TimeField({ label, value, setValue }: { label: string; value: number; setValue: (v: number) => void }) {
  return (
    <Field label={label}>
      <Input type="time" value={minutesToTime(value)} onChange={(e) => setValue(timeToMinutes(e.target.value))} className="h-10" />
    </Field>
  );
}

// ─── Live calculator ────────────────────────────────────────────────────────
const SCENARIOS = [
  { label: 'Typical lunch · 3 km · ₹400 · UPI', distanceKm: 3, hour: 13, minute: 30, dayOfWeek: 3, subtotal: 400, paymentMethod: 'RAZORPAY' },
  { label: 'Rainy dinner · 6 km · ₹650 · COD',  distanceKm: 6, hour: 20, minute: 0,  dayOfWeek: 3, subtotal: 650, paymentMethod: 'COD', rainActive: true },
  { label: 'Sunday brunch · 4 km · ₹500',        distanceKm: 4, hour: 11, minute: 30, dayOfWeek: 0, subtotal: 500, paymentMethod: 'RAZORPAY' },
  { label: 'Late-night · 8 km · ₹350',           distanceKm: 8, hour: 23, minute: 30, dayOfWeek: 5, subtotal: 350, paymentMethod: 'COD', activeMinutes: 24 }
];

function LiveCalculator({ data }: { data: RuleData }) {
  const [previews, setPreviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/platform/payouts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: data, scenarios: SCENARIOS })
      });
      if (r.ok) {
        const j = await r.json();
        setPreviews(j.results);
      }
    } finally { setLoading(false); }
  }, [data]);

  // Debounce: rerun preview 400ms after the last edit.
  useEffect(() => {
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
  }, [run]);

  return (
    <div className="lg:sticky lg:top-6 self-start space-y-3">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Calculator2Icon className="size-5 text-primary" />
            <h3 className="font-semibold">Live calculator</h3>
          </div>
          <p className="text-xs text-muted-foreground">What riders will earn under your current rule, by scenario. Updates as you edit.</p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {previews.length === 0 && (
          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground text-center">
            {loading ? 'Calculating…' : 'Edit any field to see scenarios update.'}
          </div>
        )}
        {previews.map((p, i) => (
          <ScenarioRow key={i} label={SCENARIOS[i].label} breakdown={p.breakdown} />
        ))}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
        <span>Tips go 100% to the rider on top of these numbers — they're not in the rule.</span>
      </div>
    </div>
  );
}

function ScenarioRow({ label, breakdown }: { label: string; breakdown: any }) {
  const [open, setOpen] = useState(false);
  const parts: { name: string; val: number }[] = [
    { name: 'Base',          val: breakdown.baseAmount },
    { name: `Distance (${breakdown.distanceKm} km)`, val: breakdown.perKmAmount + breakdown.longDistanceAmount },
    { name: 'Per-minute',    val: breakdown.perMinuteAmount },
    { name: 'Peak',          val: breakdown.peakBonus },
    { name: 'Late night',    val: breakdown.lateNightBonus },
    { name: 'Weekend',       val: breakdown.weekendBonus },
    { name: 'Rain',          val: breakdown.rainBonus },
    { name: 'COD fee',       val: breakdown.codFee },
    { name: 'Order share',   val: breakdown.orderShare },
    { name: 'Rating bonus',  val: breakdown.ratingBonus },
    { name: 'Daily milestone', val: breakdown.dailyMilestoneBonus },
    { name: 'Weekly milestone', val: breakdown.weeklyMilestoneBonus },
    { name: 'Wait time',     val: breakdown.waitTimeAmount },
    { name: 'Cancellation adj', val: breakdown.cancellationAdj }
  ].filter((p) => p.val !== 0);
  return (
    <div className="rounded-lg border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="w-full p-3 flex items-center justify-between gap-2 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{label}</div>
          <div className="text-[10px] text-muted-foreground">{parts.length} components</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-lg text-primary leading-none">₹{breakdown.payout}</div>
          {breakdown.applied.ceiling > 0 && breakdown.subtotal > breakdown.applied.ceiling && (
            <Badge variant="warning" className="text-[9px] mt-1">capped from ₹{breakdown.subtotal}</Badge>
          )}
          {breakdown.applied.floor > 0 && breakdown.subtotal < breakdown.applied.floor && (
            <Badge variant="success" className="text-[9px] mt-1">floor of ₹{breakdown.applied.floor}</Badge>
          )}
        </div>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t px-3 py-2.5 text-xs space-y-1">
          {parts.map((p) => (
            <div key={p.name} className="flex justify-between">
              <span className="text-muted-foreground">{p.name}</span>
              <span className={`font-mono ${p.val < 0 ? 'text-destructive' : ''}`}>{p.val < 0 ? '−' : ''}₹{Math.abs(p.val).toFixed(2)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1.5 mt-1.5 font-semibold">
            <span>Total</span><span className="text-primary">₹{breakdown.payout}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// CalculatorIcon is just the lucide icon — alias to avoid a name clash with the
// local Calculator component above.
function Calculator2Icon(props: any) { return <Calculator {...props as any} />; }
// (Renamed local component below to avoid colliding with the lucide import.)
