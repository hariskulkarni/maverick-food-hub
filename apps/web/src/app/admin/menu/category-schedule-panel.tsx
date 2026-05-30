'use client';
/**
 * Category schedule editor — collapsible row inside the admin menu manager.
 *
 * Two top-level modes:
 *   - Schedule OFF: category is governed only by isActive (the existing switch)
 *   - Schedule ON:  category needs at least one (day, window) row to be orderable
 *
 * UX notes:
 *   - 7 day-tabs (Sun..Sat) — each tab lists the windows assigned to that day
 *   - Each row is two HH:MM inputs + a remove button
 *   - "Add window" duplicates the previous row (12:00–14:00 default for a fresh tab)
 *   - "Copy to all days" lifts the current day's rows onto every other day
 *   - "Quick presets" populate sensible defaults (Breakfast/Lunch/Dinner/Weekend-only)
 *
 * Persistence: PUT /api/admin/menu/categories/[id]/schedule — replaces the
 * whole schedule atomically. DELETE turns the schedule off and clears rows.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Copy, Save, X, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function mToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function tToMin(s: string) {
  const [h, m] = s.split(':').map((v) => Number(v) || 0);
  return h * 60 + m;
}

interface Row { dayOfWeek: number; startMin: number; endMin: number }

interface Props {
  categoryId: string;
  initial: {
    scheduleEnabled: boolean;
    rows: Row[];
  };
  onClose: () => void;
}

const PRESETS: { name: string; rows: Row[] }[] = [
  // 07:00–11:00 every day
  { name: 'Breakfast', rows: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 7 * 60, endMin: 11 * 60 })) },
  // 12:00–15:00 every day
  { name: 'Lunch',     rows: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 12 * 60, endMin: 15 * 60 })) },
  // 18:00–23:00 every day
  { name: 'Dinner',    rows: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 18 * 60, endMin: 23 * 60 })) },
  // 11:00–22:00 Sat + Sun only
  { name: 'Weekend Specials', rows: [
    { dayOfWeek: 0, startMin: 11 * 60, endMin: 22 * 60 },
    { dayOfWeek: 6, startMin: 11 * 60, endMin: 22 * 60 }
  ]}
];

export function CategorySchedulePanel({ categoryId, initial, onClose }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean>(initial.scheduleEnabled);
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [activeDay, setActiveDay] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  // Sort rows for deterministic rendering — by day then startMin.
  const sorted = useMemo(() => [...rows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin), [rows]);

  // Tab-day rows
  const dayRows = useMemo(() => sorted.filter((r) => r.dayOfWeek === activeDay), [sorted, activeDay]);

  function addRow() {
    setRows((prev) => {
      // Default a new window to noon–2pm if nothing yet, otherwise duplicate
      // the last window on this day shifted by +1h.
      const dayRows = prev.filter((r) => r.dayOfWeek === activeDay);
      const last = dayRows[dayRows.length - 1];
      const start = last ? Math.min(last.endMin, 23 * 60) : 12 * 60;
      const end   = Math.min(start + 60, 24 * 60);
      return [...prev, { dayOfWeek: activeDay, startMin: start, endMin: end }];
    });
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function setRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function copyToAllDays() {
    setRows((prev) => {
      const todays = prev.filter((r) => r.dayOfWeek === activeDay);
      if (todays.length === 0) return prev;
      const replacement: Row[] = [];
      for (let d = 0; d < 7; d++) {
        for (const t of todays) {
          replacement.push({ dayOfWeek: d, startMin: t.startMin, endMin: t.endMin });
        }
      }
      return replacement;
    });
    toast.success(`Copied to all 7 days`);
  }

  function applyPreset(p: typeof PRESETS[number]) {
    setEnabled(true);
    setRows(p.rows);
    toast.info(`${p.name} preset loaded — review then save`);
  }

  const hasInvalidRow = sorted.some((r) => r.startMin >= r.endMin);
  const requiresRows = enabled && sorted.length === 0;

  async function save() {
    if (hasInvalidRow) return toast.error('Some windows have start ≥ end. Fix them first.');
    if (requiresRows) return toast.error('Add at least one window or turn the schedule off.');
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/menu/categories/${categoryId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleEnabled: enabled, rows: sorted })
      });
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
      toast.success('Schedule saved');
      router.refresh();
      onClose();
    } finally { setBusy(false); }
  }

  async function disableSchedule() {
    if (!confirm('Turn off schedule? Category will be governed by the active toggle only.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/menu/categories/${categoryId}/schedule`, { method: 'DELETE' });
      if (!r.ok) { await reportApiError(r, 'Failed to disable schedule'); return; }
      toast.success('Schedule disabled — category is always-on when active');
      router.refresh();
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <div>
            <div className="text-sm font-medium">{enabled ? 'Schedule on' : 'Schedule off'}</div>
            <div className="text-[11px] text-muted-foreground">
              {enabled ? 'Items are orderable only inside the selected windows.' : 'Category obeys only the active switch.'}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="size-4" /></Button>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <Sparkles className="size-3" /> Presets:
        </div>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
          >
            {p.name}
          </button>
        ))}
      </div>

      {enabled && (
        <>
          {/* Day tabs */}
          <div className="flex gap-1 border-b">
            {DAY_NAMES.map((d, i) => {
              const count = sorted.filter((r) => r.dayOfWeek === i).length;
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
                  {count > 0 && <span className="ml-1 text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5">{count}</span>}
                  {activeDay === i && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
                </button>
              );
            })}
          </div>

          {/* Day rows */}
          <div className="space-y-2">
            {dayRows.length === 0 && (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                No windows on {DAY_NAMES[activeDay]}. Items inside this category cannot be ordered on this day.
              </div>
            )}
            {dayRows.map((r) => {
              const realIdx = rows.indexOf(r);
              const bad = r.startMin >= r.endMin;
              return (
                <div key={realIdx} className={`flex items-end gap-2 rounded-md border p-2.5 ${bad ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`}>
                  <div className="space-y-1 flex-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Starts</Label>
                    <Input type="time" value={mToTime(r.startMin)} onChange={(e) => setRow(realIdx, { startMin: tToMin(e.target.value) })} className="h-9" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ends</Label>
                    <Input type="time" value={mToTime(r.endMin)} onChange={(e) => setRow(realIdx, { endMin: tToMin(e.target.value) })} className="h-9" />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeRow(realIdx)} aria-label="Remove window">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
            {hasInvalidRow && (
              <div className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="size-3.5" /> Each window must end after it starts.</div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3.5" /> Add window</Button>
              {dayRows.length > 0 && (
                <Button size="sm" variant="outline" onClick={copyToAllDays}><Copy className="size-3.5" /> Copy to all 7 days</Button>
              )}
            </div>
          </div>

          {requiresRows && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2">
              <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
              Add at least one window — otherwise items inside this category will be unavailable around the clock.
            </div>
          )}
        </>
      )}

      <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <strong>Audit trail:</strong> every schedule change writes a `menu.category.schedule.update` entry with before/after snapshot to the admin audit log.
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-3">
        {initial.scheduleEnabled && (
          <Button size="sm" variant="outline" onClick={disableSchedule} disabled={busy} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            Turn schedule off
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy || hasInvalidRow || requiresRows}>
          <Save className="size-3.5" /> {busy ? 'Saving…' : 'Save schedule'}
        </Button>
      </div>
    </div>
  );
}
