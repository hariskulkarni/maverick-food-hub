'use client';
/**
 * Happy Hour rule editor — create / edit dialog.
 *
 * Sections:
 *   1. Identity   — name, description, priority, isActive
 *   2. Scope      — RESTAURANT / CATEGORY / MENU_ITEM / COMBO + entity picker
 *   3. Discount   — PERCENTAGE / FIXED_PRICE / FIXED_AMOUNT_OFF + minPrice floor.
 *                   Live preview against a ₹500 sample via debounced POST to
 *                   /api/admin/happy-hours/preview.
 *   4. Schedule   — 7-day tabs (visual mirror of CategorySchedulePanel) + three
 *                   quick presets (Weekday Happy Hour / Weekend Lunch / Always on)
 *   5. Validity   — validFrom + validTo datetime-local
 *
 * Footer is sticky: Save / Cancel / (Deactivate when editing an active rule).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Plus, X, Trash2, Sparkles, Search, Info, AlertTriangle, Copy, Save,
  Clock, Percent, IndianRupee
} from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import {
  type Rule, type Category, type MenuItem, type Combo, type HappyHourScope,
  type HappyHourDiscountType, type ScheduleRow
} from './happy-hours-client';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Draft = {
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  scope: HappyHourScope;
  categoryId: string | null;
  menuItemId: string | null;
  comboId: string | null;
  discountType: HappyHourDiscountType;
  percentOff: number;
  fixedPrice: number;
  amountOff: number;
  minPrice: number;
  schedules: ScheduleRow[];
  validFrom: string;
  validTo: string;
};

const SAMPLE_PRICE = 500;

function emptyDraft(seed: Partial<Rule> = {}): Draft {
  return {
    name: seed.name ?? '',
    description: seed.description ?? '',
    priority: seed.priority ?? 0,
    isActive: seed.isActive ?? true,
    scope: (seed.scope ?? 'RESTAURANT') as HappyHourScope,
    categoryId: seed.categoryId ?? null,
    menuItemId: seed.menuItemId ?? null,
    comboId: seed.comboId ?? null,
    discountType: (seed.discountType ?? 'PERCENTAGE') as HappyHourDiscountType,
    percentOff: Number(seed.percentOff ?? 0),
    fixedPrice: Number(seed.fixedPrice ?? 0),
    amountOff: Number(seed.amountOff ?? 0),
    minPrice: Number(seed.minPrice ?? 0),
    schedules: (seed.schedules ?? []).map((s) => ({
      dayOfWeek: s.dayOfWeek, startMin: s.startMin, endMin: s.endMin
    })),
    validFrom: toLocalDateTime(seed.validFrom) || toLocalDateTime(new Date()),
    validTo: toLocalDateTime(seed.validTo)
  };
}

export function RuleEditor({
  rule, categories, menuItems, combos, onClose
}: {
  rule: Partial<Rule>;
  categories: Category[];
  menuItems: MenuItem[];
  combos: Combo[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !rule.id;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(rule));
  const [busy, setBusy] = useState(false);
  const [activeDay, setActiveDay] = useState<number>(1); // Monday default

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Sort schedules for deterministic rendering.
  const sortedSchedules = useMemo(
    () => [...draft.schedules].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin),
    [draft.schedules]
  );
  const daySchedules = useMemo(
    () => sortedSchedules.filter((s) => s.dayOfWeek === activeDay),
    [sortedSchedules, activeDay]
  );

  function addRow() {
    setDraft((d) => {
      const todays = d.schedules.filter((s) => s.dayOfWeek === activeDay);
      const last = todays[todays.length - 1];
      const start = last ? Math.min(last.endMin, 23 * 60) : 17 * 60;
      const end = Math.min(start + 60, 24 * 60);
      return {
        ...d,
        schedules: [...d.schedules, { dayOfWeek: activeDay, startMin: start, endMin: end }]
      };
    });
  }

  function removeRow(idx: number) {
    setDraft((d) => ({ ...d, schedules: d.schedules.filter((_, i) => i !== idx) }));
  }

  function setRow(idx: number, p: Partial<ScheduleRow>) {
    setDraft((d) => ({
      ...d,
      schedules: d.schedules.map((s, i) => i === idx ? { ...s, ...p } : s)
    }));
  }

  function copyToAllDays() {
    setDraft((d) => {
      const todays = d.schedules.filter((s) => s.dayOfWeek === activeDay);
      if (todays.length === 0) return d;
      const next: ScheduleRow[] = [];
      for (let day = 0; day < 7; day++) {
        for (const t of todays) {
          next.push({ dayOfWeek: day, startMin: t.startMin, endMin: t.endMin });
        }
      }
      return { ...d, schedules: next };
    });
    toast.success('Copied to all 7 days');
  }

  function applyPreset(preset: 'weekday' | 'weekend' | 'always') {
    if (preset === 'weekday') {
      setDraft((d) => ({
        ...d,
        schedules: [1, 2, 3, 4, 5].map((day) => ({ dayOfWeek: day, startMin: 17 * 60, endMin: 20 * 60 }))
      }));
      toast.info('Weekday Happy Hour preset loaded — Mon–Fri 17:00–20:00');
    } else if (preset === 'weekend') {
      setDraft((d) => ({
        ...d,
        schedules: [0, 6].map((day) => ({ dayOfWeek: day, startMin: 12 * 60, endMin: 15 * 60 }))
      }));
      toast.info('Weekend Lunch preset loaded — Sat+Sun 12:00–15:00');
    } else {
      setDraft((d) => ({ ...d, schedules: [] }));
      toast.info('Always-on preset — no schedule rows. The rule runs 24/7 within validity.');
    }
  }

  const hasInvalidRow = sortedSchedules.some((s) => s.startMin >= s.endMin);

  async function save() {
    if (!draft.name.trim() || draft.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (draft.scope === 'CATEGORY' && !draft.categoryId) {
      toast.error('Pick a category for category-scope rules');
      return;
    }
    if (draft.scope === 'MENU_ITEM' && !draft.menuItemId) {
      toast.error('Pick a menu item for item-scope rules');
      return;
    }
    if (draft.scope === 'COMBO' && !draft.comboId) {
      toast.error('Pick a combo for combo-scope rules');
      return;
    }
    if (draft.discountType === 'PERCENTAGE' && (draft.percentOff <= 0 || draft.percentOff > 100)) {
      toast.error('Percent off must be between 0 and 100');
      return;
    }
    if (draft.discountType === 'FIXED_PRICE' && draft.fixedPrice <= 0) {
      toast.error('Fixed price must be positive');
      return;
    }
    if (draft.discountType === 'FIXED_AMOUNT_OFF' && draft.amountOff <= 0) {
      toast.error('Amount off must be positive');
      return;
    }
    if (hasInvalidRow) {
      toast.error('Some schedule windows have start ≥ end. Fix them first.');
      return;
    }
    if (!draft.validFrom) {
      toast.error('Valid-from is required');
      return;
    }
    setBusy(true);
    try {
      const body = buildBody(draft);
      const url = isNew ? '/api/admin/happy-hours' : `/api/admin/happy-hours/${rule.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        await reportApiError(r, isNew ? 'Could not create rule' : 'Could not save rule');
        return;
      }
      toast.success(isNew ? 'Happy hour rule created' : 'Rule saved');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!rule.id) return;
    if (!confirm(`Deactivate "${rule.name}"? The rule stops applying immediately.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/happy-hours/${rule.id}`, { method: 'DELETE' });
      if (!r.ok) {
        await reportApiError(r, 'Could not deactivate rule');
        return;
      }
      toast.success('Rule deactivated');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <div className="p-6 pb-2">
          <DialogHeader>
            <DialogTitle>{isNew ? 'New Happy Hour rule' : `Edit ${rule.name}`}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 space-y-6">
          {/* ── 1. Identity ─────────────────────────────────────────── */}
          <Section title="Identity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Rule name"
                required
                value={draft.name}
                onChange={(v) => patch('name', v)}
                placeholder="e.g. Weekday cocktails"
              />
              <Field
                label="Priority (higher wins)"
                type="number"
                value={String(draft.priority)}
                onChange={(v) => patch('priority', Number(v) || 0)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={draft.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="Optional admin note — what this rule is for"
              />
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch checked={draft.isActive} onCheckedChange={(v) => patch('isActive', v)} />
              <div>
                <div className="text-sm font-medium">{draft.isActive ? 'Active' : 'Inactive'}</div>
                <div className="text-[11px] text-muted-foreground">
                  Toggle off to suspend the rule without losing its configuration.
                </div>
              </div>
            </div>
          </Section>

          {/* ── 2. Scope ────────────────────────────────────────────── */}
          <Section title="Scope">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <ScopeRadio
                label="All restaurant"
                hint="Every item & combo"
                active={draft.scope === 'RESTAURANT'}
                onClick={() => setDraft((d) => ({ ...d, scope: 'RESTAURANT', categoryId: null, menuItemId: null, comboId: null }))}
              />
              <ScopeRadio
                label="Category"
                hint="One full category"
                active={draft.scope === 'CATEGORY'}
                onClick={() => setDraft((d) => ({ ...d, scope: 'CATEGORY', menuItemId: null, comboId: null }))}
              />
              <ScopeRadio
                label="Menu item"
                hint="A single item"
                active={draft.scope === 'MENU_ITEM'}
                onClick={() => setDraft((d) => ({ ...d, scope: 'MENU_ITEM', categoryId: null, comboId: null }))}
              />
              <ScopeRadio
                label="Combo"
                hint="A single combo"
                active={draft.scope === 'COMBO'}
                onClick={() => setDraft((d) => ({ ...d, scope: 'COMBO', categoryId: null, menuItemId: null }))}
              />
            </div>

            {draft.scope === 'CATEGORY' && (
              <SearchPicker
                label="Pick category"
                options={categories.map((c) => ({ id: c.id, label: c.name }))}
                selected={draft.categoryId}
                onChange={(id) => patch('categoryId', id)}
                placeholder="Search categories…"
              />
            )}
            {draft.scope === 'MENU_ITEM' && (
              <SearchPicker
                label="Pick menu item"
                options={menuItems.map((m) => ({ id: m.id, label: m.name, sub: money(Number(m.price)) }))}
                selected={draft.menuItemId}
                onChange={(id) => patch('menuItemId', id)}
                placeholder="Search items…"
              />
            )}
            {draft.scope === 'COMBO' && (
              <SearchPicker
                label="Pick combo"
                options={combos.map((c) => ({ id: c.id, label: c.name, sub: money(Number(c.price)) }))}
                selected={draft.comboId}
                onChange={(id) => patch('comboId', id)}
                placeholder="Search combos…"
              />
            )}

            <div className="rounded-md border bg-muted/30 p-3 text-xs flex items-start gap-2">
              <Info className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                This rule will hit{' '}
                <strong className="text-foreground">{scopeWillHit(draft, categories, menuItems, combos)}</strong>.
              </span>
            </div>
          </Section>

          {/* ── 3. Discount ─────────────────────────────────────────── */}
          <Section title="Discount">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ScopeRadio
                label="Percentage"
                hint="X% off"
                active={draft.discountType === 'PERCENTAGE'}
                onClick={() => patch('discountType', 'PERCENTAGE')}
                icon={Percent}
              />
              <ScopeRadio
                label="Fixed price"
                hint='"Just ₹199"'
                active={draft.discountType === 'FIXED_PRICE'}
                onClick={() => patch('discountType', 'FIXED_PRICE')}
                icon={IndianRupee}
              />
              <ScopeRadio
                label="Amount off"
                hint="Flat ₹ off"
                active={draft.discountType === 'FIXED_AMOUNT_OFF'}
                onClick={() => patch('discountType', 'FIXED_AMOUNT_OFF')}
                icon={IndianRupee}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {draft.discountType === 'PERCENTAGE' && (
                <Field
                  label="Percent off (%)"
                  type="number"
                  required
                  value={String(draft.percentOff)}
                  onChange={(v) => patch('percentOff', Math.min(100, Math.max(0, Number(v) || 0)))}
                />
              )}
              {draft.discountType === 'FIXED_PRICE' && (
                <Field
                  label="New unit price (₹)"
                  type="number"
                  required
                  value={String(draft.fixedPrice)}
                  onChange={(v) => patch('fixedPrice', Math.max(0, Number(v) || 0))}
                />
              )}
              {draft.discountType === 'FIXED_AMOUNT_OFF' && (
                <Field
                  label="Amount off (₹)"
                  type="number"
                  required
                  value={String(draft.amountOff)}
                  onChange={(v) => patch('amountOff', Math.max(0, Number(v) || 0))}
                />
              )}
              <Field
                label="Minimum price floor (₹)"
                type="number"
                value={String(draft.minPrice)}
                onChange={(v) => patch('minPrice', Math.max(0, Number(v) || 0))}
                help="Effective price never drops below this. 0 = no floor."
              />
            </div>

            <PreviewPanel draft={draft} />
          </Section>

          {/* ── 4. Schedule ─────────────────────────────────────────── */}
          <Section title="Schedule">
            <div className="flex flex-wrap gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <Sparkles className="size-3" /> Presets:
              </div>
              <button
                type="button"
                onClick={() => applyPreset('weekday')}
                className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Weekday Happy Hour
              </button>
              <button
                type="button"
                onClick={() => applyPreset('weekend')}
                className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Weekend Lunch
              </button>
              <button
                type="button"
                onClick={() => applyPreset('always')}
                className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Always on
              </button>
            </div>

            {/* Day tabs */}
            <div className="flex gap-1 border-b">
              {DAY_NAMES.map((d, i) => {
                const count = sortedSchedules.filter((r) => r.dayOfWeek === i).length;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveDay(i)}
                    className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                      activeDay === i ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {d}
                    {count > 0 && (
                      <span className="ml-1 text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5">{count}</span>
                    )}
                    {activeDay === i && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
                  </button>
                );
              })}
            </div>

            {/* Rows for active day */}
            <div className="space-y-2">
              {daySchedules.length === 0 && (
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                  No windows on {DAY_NAMES[activeDay]}. The rule won't trigger on this day.
                </div>
              )}
              {daySchedules.map((r) => {
                const realIdx = draft.schedules.indexOf(r);
                const bad = r.startMin >= r.endMin;
                return (
                  <div
                    key={realIdx}
                    className={`flex items-end gap-2 rounded-md border p-2.5 ${bad ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`}
                  >
                    <div className="space-y-1 flex-1">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Starts</Label>
                      <Input
                        type="time"
                        value={mToTime(r.startMin)}
                        onChange={(e) => setRow(realIdx, { startMin: tToMin(e.target.value) })}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1 flex-1">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ends</Label>
                      <Input
                        type="time"
                        value={mToTime(r.endMin)}
                        onChange={(e) => setRow(realIdx, { endMin: tToMin(e.target.value) })}
                        className="h-9"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeRow(realIdx)}
                      aria-label="Remove window"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
              {hasInvalidRow && (
                <div className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5" /> Each window must end after it starts.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={addRow}>
                  <Plus className="size-3.5" /> Add window
                </Button>
                {daySchedules.length > 0 && (
                  <Button size="sm" variant="outline" onClick={copyToAllDays}>
                    <Copy className="size-3.5" /> Copy to all 7 days
                  </Button>
                )}
              </div>
            </div>

            {draft.schedules.length === 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  No schedule rows — this rule will be active 24/7 within its validity range.
                  Double-check this is what you want.
                </span>
              </div>
            )}
          </Section>

          {/* ── 5. Validity ─────────────────────────────────────────── */}
          <Section title="Validity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Valid from"
                type="datetime-local"
                required
                value={draft.validFrom}
                onChange={(v) => patch('validFrom', v)}
              />
              <Field
                label="Valid until"
                type="datetime-local"
                value={draft.validTo}
                onChange={(v) => patch('validTo', v)}
                help="Leave blank for no end"
              />
            </div>
          </Section>

          {/* Audit reminder */}
          <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <strong>Audit trail:</strong> every change writes an entry (
            <code>happyhour.create</code> / <code>happyhour.update</code> /{' '}
            <code>happyhour.schedule.update</code> / <code>happyhour.deactivate</code>) to the platform audit log.
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t bg-background p-4">
          <div>
            {!isNew && rule.isActive && (
              <Button
                variant="outline"
                onClick={deactivate}
                disabled={busy}
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Deactivate
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              <Save className="size-4" /> {busy ? 'Saving…' : (isNew ? 'Create rule' : 'Save changes')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Preview panel (debounced, 400ms) ──────────────────────────────────────

function PreviewPanel({ draft }: { draft: Draft }) {
  const [preview, setPreview] = useState<{
    effective: number | null; savings: number; label: string | null; note?: string; loading: boolean;
  }>({ effective: null, savings: 0, label: null, loading: false });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runPreview(), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify({
    scope: draft.scope,
    categoryId: draft.categoryId,
    menuItemId: draft.menuItemId,
    comboId: draft.comboId,
    discountType: draft.discountType,
    percentOff: draft.percentOff,
    fixedPrice: draft.fixedPrice,
    amountOff: draft.amountOff,
    minPrice: draft.minPrice,
    schedules: draft.schedules,
    isActive: draft.isActive
  })]);

  async function runPreview() {
    setPreview((p) => ({ ...p, loading: true }));
    try {
      const body = {
        draft: {
          scope: draft.scope,
          categoryId: draft.categoryId,
          menuItemId: draft.menuItemId,
          comboId: draft.comboId,
          discountType: draft.discountType,
          percentOff: draft.discountType === 'PERCENTAGE' ? draft.percentOff : null,
          fixedPrice: draft.discountType === 'FIXED_PRICE' ? draft.fixedPrice : null,
          amountOff: draft.discountType === 'FIXED_AMOUNT_OFF' ? draft.amountOff : null,
          minPrice: draft.minPrice > 0 ? draft.minPrice : null,
          validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : new Date().toISOString(),
          validTo: draft.validTo ? new Date(draft.validTo).toISOString() : null,
          isActive: draft.isActive,
          schedules: draft.schedules
        },
        sampleItemPrice: SAMPLE_PRICE
      };
      const r = await fetch('/api/admin/happy-hours/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        setPreview({ effective: null, savings: 0, label: null, note: `Preview failed (${r.status})`, loading: false });
        return;
      }
      const j = await r.json();
      setPreview({
        effective: Number(j.effectivePrice ?? SAMPLE_PRICE),
        savings: Number(j.savings ?? 0),
        label: j.label ?? null,
        note: j.note,
        loading: false
      });
    } catch (e: any) {
      setPreview({ effective: null, savings: 0, label: null, note: e?.message ?? 'Preview error', loading: false });
    }
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" /> Live preview
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Sample item priced at {money(SAMPLE_PRICE)} — the discount math runs as if the rule were in window.
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          {preview.loading ? (
            <div className="text-xs text-muted-foreground animate-pulse">Calculating…</div>
          ) : preview.note ? (
            <div className="text-sm text-muted-foreground">{preview.note}</div>
          ) : preview.effective != null && preview.savings > 0 ? (
            <div className="text-sm">
              Customer pays{' '}
              <span className="font-semibold text-primary">{money(preview.effective)}</span>{' '}
              <span className="text-muted-foreground line-through">(was {money(SAMPLE_PRICE)})</span>
              {preview.label && <span className="ml-2 text-xs text-muted-foreground">· {preview.label}</span>}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No discount applied for this configuration.</div>
          )}
        </div>
        <Badge variant="muted" className="shrink-0 text-[10px]">Sample only</Badge>
      </div>
    </div>
  );
}

// ─── Building blocks ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false, help, placeholder
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
}) {
  return (
    <div>
      {label && <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>}
      <Input
        className={label ? 'mt-1' : ''}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {help && <div className="text-[11px] text-muted-foreground mt-1">{help}</div>}
    </div>
  );
}

function ScopeRadio({
  label, hint, active, onClick, icon: Icon
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
  icon?: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="size-3.5" />} {label}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

function SearchPicker({
  label, options, selected, onChange, placeholder
}: {
  label: string;
  options: { id: string; label: string; sub?: string }[];
  selected: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selectedOpt = options.find((o) => o.id === selected);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 30);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 30);
  }, [query, options]);

  return (
    <div>
      <Label>{label}</Label>
      {selectedOpt && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary px-2 py-0.5 text-xs">
            {selectedOpt.label}
            {selectedOpt.sub && <span className="text-muted-foreground">· {selectedOpt.sub}</span>}
            <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${selectedOpt.label}`}>
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}
      <div className="relative mt-2">
        <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8"
          placeholder={placeholder ?? 'Search…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md">
            {filtered.map((o) => {
              const on = selected === o.id;
              return (
                <button
                  type="button"
                  key={o.id}
                  onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setQuery(''); setOpen(false); }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent ${on ? 'bg-primary/5' : ''}`}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    {o.sub && <span className="tabular-nums">{o.sub}</span>}
                    {on && <Badge variant="success" className="text-[10px]">selected</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function scopeWillHit(draft: Draft, categories: Category[], menuItems: MenuItem[], combos: Combo[]): string {
  switch (draft.scope) {
    case 'RESTAURANT': return 'every item & combo across the restaurant';
    case 'CATEGORY': {
      const c = categories.find((x) => x.id === draft.categoryId);
      return c ? `every item in "${c.name}"` : 'a single category (not picked yet)';
    }
    case 'MENU_ITEM': {
      const m = menuItems.find((x) => x.id === draft.menuItemId);
      return m ? `only "${m.name}"` : 'a single menu item (not picked yet)';
    }
    case 'COMBO': {
      const c = combos.find((x) => x.id === draft.comboId);
      return c ? `only the "${c.name}" combo` : 'a single combo (not picked yet)';
    }
  }
}

function buildBody(draft: Draft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    scope: draft.scope,
    categoryId: draft.scope === 'CATEGORY' ? draft.categoryId : null,
    menuItemId: draft.scope === 'MENU_ITEM' ? draft.menuItemId : null,
    comboId: draft.scope === 'COMBO' ? draft.comboId : null,
    discountType: draft.discountType,
    percentOff: draft.discountType === 'PERCENTAGE' ? draft.percentOff : null,
    fixedPrice: draft.discountType === 'FIXED_PRICE' ? draft.fixedPrice : null,
    amountOff: draft.discountType === 'FIXED_AMOUNT_OFF' ? draft.amountOff : null,
    minPrice: draft.minPrice > 0 ? draft.minPrice : null,
    validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : new Date().toISOString(),
    validTo: draft.validTo ? new Date(draft.validTo).toISOString() : null,
    priority: draft.priority,
    isActive: draft.isActive,
    schedules: draft.schedules
  };
}

function mToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function tToMin(s: string): number {
  const [h, m] = s.split(':').map((v) => Number(v) || 0);
  return h * 60 + m;
}

function toLocalDateTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
