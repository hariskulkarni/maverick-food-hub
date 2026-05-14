'use client';
/**
 * Per-rider payout override editor — rendered inside the rider detail drawer.
 *
 * Status surface (matches the spec):
 *   - "Using custom payout rule"  → primary-accented chip with the changed fields
 *   - "Using platform default"    → muted chip
 *
 * Body sections:
 *   1. Editor — five optional override knobs (basePay, perKmRate, minPayout,
 *      maxPayout, codHandlingFee) + effective window + notes
 *   2. Preview calculator — three canned scenarios with side-by-side comparison
 *      against the platform default; updates 400ms after each edit
 *   3. History — last 10 changes to this rider's overrides
 *
 * Persistence: PUT /api/platform/riders/[id]/payout-override (upsert),
 * DELETE the same path to revert to platform default. All API mutations are
 * audited server-side.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Calculator, ChevronDown, Save, RotateCcw, Sparkles, BadgeCheck, ShieldCheck,
  History as HistoryIcon, AlertCircle, Equal, ArrowDownRight, ArrowUpRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface OverrideRow {
  id: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  basePay: string | number | null;
  perKmRate: string | number | null;
  minPayout: string | number | null;
  maxPayout: string | number | null;
  codHandlingFee: string | number | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PlatformRuleRow {
  baseAmount?: string | number;
  perKmAmount?: string | number;
  minimumPerDelivery?: string | number;
  maxPerDelivery?: string | number;
  codHandlingFee?: string | number;
}

interface ApiResponse {
  rider: { id: string; name: string | null; phone: string | null };
  override: OverrideRow | null;
  platformRule: PlatformRuleRow | null;
  source: 'rider' | 'platform';
  history: OverrideRow[];
}

interface DraftState {
  basePay: string;
  perKmRate: string;
  minPayout: string;
  maxPayout: string;
  codHandlingFee: string;
  notes: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const EMPTY_DRAFT: DraftState = {
  basePay: '', perKmRate: '', minPayout: '', maxPayout: '', codHandlingFee: '',
  notes: '', effectiveFrom: '', effectiveTo: ''
};

function toStr(v: string | number | null | undefined): string {
  return v == null || v === '' ? '' : String(Number(v));
}
function toNumOrNull(v: string): number | null {
  return v.trim() === '' ? null : Number(v);
}

const SCENARIOS = [
  { label: 'Typical · 3 km · ₹400 · UPI', distanceKm: 3, hour: 13, minute: 30, dayOfWeek: 3, subtotal: 400, paymentMethod: 'RAZORPAY' },
  { label: 'Longer · 7 km · ₹600 · COD',   distanceKm: 7, hour: 20, minute: 0,  dayOfWeek: 5, subtotal: 600, paymentMethod: 'COD' },
  { label: 'Short · 2 km · ₹250 · COD',    distanceKm: 2, hour: 12, minute: 30, dayOfWeek: 1, subtotal: 250, paymentMethod: 'COD' }
];

export function PayoutOverridePanel({ riderId }: { riderId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/platform/riders/${riderId}/payout-override`, { cache: 'no-store' });
      if (r.ok) {
        const j: ApiResponse = await r.json();
        setData(j);
        // Seed the draft form with the current active override (if any) so
        // edits start from the live state, not an empty form.
        if (j.override) {
          setDraft({
            basePay:        toStr(j.override.basePay),
            perKmRate:      toStr(j.override.perKmRate),
            minPayout:      toStr(j.override.minPayout),
            maxPayout:      toStr(j.override.maxPayout),
            codHandlingFee: toStr(j.override.codHandlingFee),
            notes:          j.override.notes ?? '',
            effectiveFrom:  j.override.effectiveFrom ? new Date(j.override.effectiveFrom).toISOString().slice(0, 16) : '',
            effectiveTo:    j.override.effectiveTo   ? new Date(j.override.effectiveTo).toISOString().slice(0, 16)   : ''
          });
        } else {
          setDraft(EMPTY_DRAFT);
        }
      }
    } finally { setLoading(false); }
  }, [riderId]);
  useEffect(() => { load(); }, [load]);

  const hasAnyOverrideField = useMemo(() => (
    draft.basePay !== '' || draft.perKmRate !== '' || draft.minPayout !== '' ||
    draft.maxPayout !== '' || draft.codHandlingFee !== ''
  ), [draft]);

  // Debounced preview — 400ms after the last edit.
  const runPreview = useCallback(async () => {
    if (!hasAnyOverrideField) { setPreviews(null); return; }
    setPreviewLoading(true);
    try {
      const r = await fetch(`/api/platform/riders/${riderId}/payout-override/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: {
            basePay:        toNumOrNull(draft.basePay),
            perKmRate:      toNumOrNull(draft.perKmRate),
            minPayout:      toNumOrNull(draft.minPayout),
            maxPayout:      toNumOrNull(draft.maxPayout),
            codHandlingFee: toNumOrNull(draft.codHandlingFee)
          },
          scenarios: SCENARIOS
        })
      });
      if (r.ok) {
        const j = await r.json();
        setPreviews(j.results);
      }
    } finally { setPreviewLoading(false); }
  }, [riderId, draft, hasAnyOverrideField]);
  useEffect(() => { const t = setTimeout(runPreview, 400); return () => clearTimeout(t); }, [runPreview]);

  async function save() {
    if (!hasAnyOverrideField) return toast.error('Set at least one override field, or click "Revert to platform default".');
    setBusy(true);
    try {
      const body = {
        basePay:        toNumOrNull(draft.basePay),
        perKmRate:      toNumOrNull(draft.perKmRate),
        minPayout:      toNumOrNull(draft.minPayout),
        maxPayout:      toNumOrNull(draft.maxPayout),
        codHandlingFee: toNumOrNull(draft.codHandlingFee),
        notes: draft.notes || null,
        effectiveFrom: draft.effectiveFrom ? new Date(draft.effectiveFrom).toISOString() : null,
        effectiveTo:   draft.effectiveTo   ? new Date(draft.effectiveTo).toISOString()   : null
      };
      const r = await fetch(`/api/platform/riders/${riderId}/payout-override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) { toast.error('Save failed: ' + (await r.text())); return; }
      toast.success('Custom payout rule saved');
      await load();
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!confirm('Revert this rider back to the platform default payout rule?')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/riders/${riderId}/payout-override`, { method: 'DELETE' });
      if (!r.ok) { toast.error('Deactivate failed: ' + (await r.text())); return; }
      toast.success('Reverted to platform default');
      setDraft(EMPTY_DRAFT);
      await load();
    } finally { setBusy(false); }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading payout rule…</div>;
  if (!data) return null;

  const usingCustom = data.source === 'rider';

  return (
    <div className="space-y-3">
      {/* Status pill */}
      <div className="flex items-start gap-3 rounded-lg border bg-card p-3.5">
        {usingCustom ? (
          <>
            <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Sparkles className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">Using custom payout rule</span>
                <Badge variant="warning" className="text-[10px]">RIDER OVERRIDE</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summariseOverride(data.override!, data.platformRule)}
              </p>
              {data.override?.notes && (
                <p className="text-xs italic text-muted-foreground mt-1">"{data.override.notes}"</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground shrink-0">
              <ShieldCheck className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">Using platform default</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Base ₹{toStr(data.platformRule?.baseAmount) || '30'} · Per-km ₹{toStr(data.platformRule?.perKmAmount) || '5'} · COD fee ₹{toStr(data.platformRule?.codHandlingFee) || '0'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Editor toggle */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2 text-sm">
          <BadgeCheck className="size-4 text-primary" />
          <span className="font-medium">{usingCustom ? 'Edit override' : 'Set a custom payout rule'}</span>
        </div>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField
              label="Base pay (₹/delivery)"
              placeholder={toStr(data.platformRule?.baseAmount) || '30'}
              value={draft.basePay}
              onChange={(v) => setDraft({ ...draft, basePay: v })}
              hint="Override the platform base. Blank = inherit."
            />
            <NumField
              label="Per-km rate (₹/km)"
              placeholder={toStr(data.platformRule?.perKmAmount) || '5'}
              value={draft.perKmRate}
              onChange={(v) => setDraft({ ...draft, perKmRate: v })}
            />
            <NumField
              label="Min payout (₹)"
              placeholder={toStr(data.platformRule?.minimumPerDelivery) || '0'}
              value={draft.minPayout}
              onChange={(v) => setDraft({ ...draft, minPayout: v })}
              hint="Floor — 0 means no minimum."
            />
            <NumField
              label="Max payout (₹)"
              placeholder={toStr(data.platformRule?.maxPerDelivery) || '0 = uncapped'}
              value={draft.maxPayout}
              onChange={(v) => setDraft({ ...draft, maxPayout: v })}
              hint="Ceiling — 0 means uncapped."
            />
            <NumField
              label="COD handling fee (₹)"
              placeholder={toStr(data.platformRule?.codHandlingFee) || '0'}
              value={draft.codHandlingFee}
              onChange={(v) => setDraft({ ...draft, codHandlingFee: v })}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Notes (internal)</Label>
              <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Why this rider gets a custom rule…" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Effective from</Label>
              <Input type="datetime-local" value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Expires at (optional)</Label>
              <Input type="datetime-local" value={draft.effectiveTo} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Calculator className="size-4 text-primary" />
              <span className="text-sm font-semibold">Preview vs platform default</span>
              {previewLoading && <span className="text-[10px] text-muted-foreground">Calculating…</span>}
            </div>
            {!hasAnyOverrideField && (
              <p className="text-xs text-muted-foreground">Fill in at least one field above to see how this rider's earnings will change.</p>
            )}
            {previews && previews.map((p: any, i: number) => (
              <PreviewRow key={i} label={SCENARIOS[i].label} platform={p.platform.payout} withOverride={p.withOverride.payout} delta={p.delta} />
            ))}
          </div>

          <div className="rounded-lg border bg-warning/5 border-warning/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0 text-warning" />
            <span><strong>Audit trail:</strong> creating, updating, or deactivating an override writes an entry to the platform audit log with before/after snapshots and your admin id.</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              {usingCustom && (
                <Button size="sm" variant="outline" onClick={deactivate} disabled={busy} className="text-destructive border-destructive/40 hover:bg-destructive/10">
                  <RotateCcw className="size-3.5" /> Revert to platform default
                </Button>
              )}
            </div>
            <Button size="sm" onClick={save} disabled={busy || !hasAnyOverrideField}>
              <Save className="size-3.5" /> {busy ? 'Saving…' : usingCustom ? 'Update override' : 'Save override'}
            </Button>
          </div>
        </div>
      )}

      {/* History */}
      {data.history.length > 0 && (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer p-3 text-xs font-medium text-muted-foreground flex items-center gap-2 hover:bg-accent">
            <HistoryIcon className="size-3.5" /> Change history ({data.history.length})
          </summary>
          <ul className="divide-y text-xs">
            {data.history.map((h) => (
              <li key={h.id} className="p-3 flex items-start gap-3">
                <div className={`size-2 rounded-full mt-1.5 shrink-0 ${h.isActive ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {h.isActive ? 'Active' : 'Deactivated'}
                    {' · '}
                    <span className="text-muted-foreground">{new Date(h.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {[
                      h.basePay        != null && `base ₹${Number(h.basePay)}`,
                      h.perKmRate      != null && `₹${Number(h.perKmRate)}/km`,
                      h.minPayout      != null && `floor ₹${Number(h.minPayout)}`,
                      h.maxPayout      != null && `ceiling ₹${Number(h.maxPayout)}`,
                      h.codHandlingFee != null && `COD ₹${Number(h.codHandlingFee)}`
                    ].filter(Boolean).join(' · ') || '(no override values)'}
                  </div>
                  {h.notes && <div className="italic text-muted-foreground/80 mt-0.5">"{h.notes}"</div>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
        <Input
          type="number" step="0.5" min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-7"
        />
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PreviewRow({ label, platform, withOverride, delta }: { label: string; platform: number; withOverride: number; delta: number }) {
  const sign = delta > 0 ? 'up' : delta < 0 ? 'down' : 'equal';
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground truncate">{label}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          {sign === 'up'   && <Badge variant="success" className="text-[9px] gap-0.5"><ArrowUpRight className="size-2.5" /> +₹{delta.toFixed(2)}</Badge>}
          {sign === 'down' && <Badge variant="destructive" className="text-[9px] gap-0.5"><ArrowDownRight className="size-2.5" /> ₹{delta.toFixed(2)}</Badge>}
          {sign === 'equal'&& <Badge variant="muted" className="text-[9px] gap-0.5"><Equal className="size-2.5" /> no change</Badge>}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Platform default</span><span className="font-mono">₹{platform.toFixed(2)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">With override</span><span className="font-mono font-semibold text-primary">₹{withOverride.toFixed(2)}</span></div>
      </div>
    </div>
  );
}

function summariseOverride(o: OverrideRow, p: PlatformRuleRow | null): string {
  const parts: string[] = [];
  if (o.basePay        != null) parts.push(`base ₹${Number(o.basePay)} (vs ₹${toStr(p?.baseAmount) || '30'})`);
  if (o.perKmRate      != null) parts.push(`₹${Number(o.perKmRate)}/km (vs ₹${toStr(p?.perKmAmount) || '5'})`);
  if (o.minPayout      != null) parts.push(`floor ₹${Number(o.minPayout)}`);
  if (o.maxPayout      != null) parts.push(`ceiling ₹${Number(o.maxPayout)}`);
  if (o.codHandlingFee != null) parts.push(`COD ₹${Number(o.codHandlingFee)}`);
  return parts.length ? parts.join(' · ') : 'No override fields set.';
}
