'use client';
/**
 * My shifts — book and cancel work slots via GET/POST /api/rider/shifts and
 * DELETE /api/rider/shifts/[id] (same slots and rules as the app). Starting
 * and finishing a shift happens in the app, where you go online.
 */
import { useState } from 'react';
import { CalendarClock, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { riderApi } from '../../_lib/api';
import type { Shift } from '../../_lib/types';
import { ErrorPanel, PageHeader, Panel, inputCls, useLoad } from '../../_components/bits';

const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
const STATUS: Record<string, { label: string; cls: string }> = {
  BOOKED: { label: 'Booked', cls: 'bg-primary/10 text-primary' },
  STARTED: { label: 'In progress', cls: 'bg-success/15 text-success' },
  COMPLETED: { label: 'Completed', cls: 'bg-muted text-muted-foreground' },
  MISSED: { label: 'Missed', cls: 'bg-destructive/10 text-destructive' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function upcomingDays() {
  const base = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return {
      key: ymd(d),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }),
      sub: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    };
  });
}
function prettyDate(s: string): string {
  return new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ShiftsView() {
  const shifts = useLoad(() => riderApi<{ shifts: Shift[] }>('/api/rider/shifts'));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const today = ymd(new Date());
  const all = (shifts.data?.shifts ?? []).slice();
  const upcoming = all
    .filter((s) => (s.status === 'BOOKED' || s.status === 'STARTED') && s.date.slice(0, 10) >= today)
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  const past = all.filter((s) => !upcoming.includes(s)).slice(0, 20);

  async function cancel(s: Shift) {
    setBusyId(s.id);
    try {
      await riderApi(`/api/rider/shifts/${s.id}`, { method: 'DELETE' });
      toast.success('Shift cancelled.');
      setConfirmId(null);
      await shifts.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="My shifts" intro="Book work windows ahead of time. You start and finish a shift in the app when you go online." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Upcoming">
            {shifts.error ? (
              <ErrorPanel message={shifts.error} onRetry={shifts.reload} />
            ) : shifts.loading && !shifts.data ? (
              <Skeleton className="h-24" />
            ) : upcoming.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No upcoming shifts" description="Book a slot to lock in a work window." className="p-6" />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((s) => {
                  const chip = STATUS[s.status] ?? { label: s.status, cls: 'bg-muted' };
                  return (
                    <li key={s.id} className="rounded-xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold">{prettyDate(s.date)}</div>
                          <div className="text-sm text-muted-foreground">
                            {s.startTime} – {s.endTime}
                            {s.zoneName ? ` · ${s.zoneName}` : ''}
                          </div>
                        </div>
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', chip.cls)}>{chip.label}</span>
                      </div>
                      {s.status === 'BOOKED' &&
                        (confirmId === s.id ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                            <span>Remove this shift?</span>
                            <Button size="sm" variant="destructive" className="min-h-11" disabled={busyId === s.id} onClick={() => cancel(s)}>
                              {busyId === s.id && <Loader2 className="animate-spin" />} Yes, cancel it
                            </Button>
                            <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmId(null)}>
                              Keep it
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={() => setConfirmId(s.id)}>
                            <Trash2 /> Cancel shift
                          </Button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {past.length > 0 && (
            <Panel title="Past & cancelled">
              <ul className="divide-y">
                {past.map((s) => {
                  const chip = STATUS[s.status] ?? { label: s.status, cls: 'bg-muted' };
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {prettyDate(s.date)} · {s.startTime}–{s.endTime}
                      </span>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', chip.cls)}>{chip.label}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
        <BookForm onBooked={shifts.reload} />
      </div>
    </div>
  );
}

function BookForm({ onBooked }: { onBooked: () => Promise<void> }) {
  const days = upcomingDays();
  const [date, setDate] = useState(days[0].key);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = endTime > startTime;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return toast.error('End time must be after start time.');
    setBusy(true);
    try {
      await riderApi('/api/rider/shifts', { method: 'POST', body: { date, startTime, endTime, zoneName: zone.trim() || null } });
      toast.success('Slot booked — your shift is on the calendar.');
      setZone('');
      await onBooked();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Book a slot" className="h-fit">
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">Day</legend>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                aria-pressed={date === d.key}
                onClick={() => setDate(d.key)}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center rounded-xl border-2 px-1 text-xs',
                  date === d.key ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted',
                )}
              >
                <span className="font-semibold">{d.label}</span>
                <span className="text-muted-foreground">{d.sub}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sh-start">Start</Label>
            <select id="sh-start" className={cn(inputCls, 'mt-1')} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sh-end">End</Label>
            <select id="sh-end" className={cn(inputCls, 'mt-1')} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t} disabled={t <= startTime}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!valid && <p className="text-sm text-destructive">End time must be after start time.</p>}
        <div>
          <Label htmlFor="sh-zone">Preferred zone (optional)</Label>
          <input id="sh-zone" className={cn(inputCls, 'mt-1')} value={zone} onChange={(e) => setZone(e.target.value)} maxLength={80} placeholder="e.g. Brodipet" />
        </div>
        <Button type="submit" className="min-h-11 w-full" disabled={busy || !valid}>
          {busy && <Loader2 className="animate-spin" />} Book this slot
        </Button>
      </form>
    </Panel>
  );
}
