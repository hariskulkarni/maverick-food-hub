'use client';
/**
 * Rider shifts — read-only explorer. Splits rows into Upcoming/Today vs Past,
 * with status chips and a date-range filter. No mutations; this is an
 * operational visibility view.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtDate } from '@/lib/utils';
import { CalendarClock, MapPin } from 'lucide-react';

type ShiftStatus = 'BOOKED' | 'STARTED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

interface ShiftRow {
  id: string;
  riderId: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  zoneName: string | null;
  status: ShiftStatus;
  createdAt: string;
  rider: { id: string; name: string | null; phone: string | null };
}

const STATUSES: (ShiftStatus | 'ALL')[] = ['ALL', 'BOOKED', 'STARTED', 'COMPLETED', 'MISSED', 'CANCELLED'];

function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function RiderShiftsClient({ initial }: { initial: ShiftRow[] }) {
  const [status, setStatus] = useState<ShiftStatus | 'ALL'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(() => {
    let r = initial.slice();
    if (status !== 'ALL') r = r.filter((x) => x.status === status);
    if (from) r = r.filter((x) => x.date >= from);
    if (to) r = r.filter((x) => x.date <= to);
    return r;
  }, [initial, status, from, to]);

  const today = todayStr();
  const upcoming = filtered
    .filter((s) => s.date >= today)
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  const past = filtered
    .filter((s) => s.date < today)
    .sort((a, b) => (a.date === b.date ? b.startTime.localeCompare(a.startTime) : b.date.localeCompare(a.date)));

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From date</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1 w-[160px]" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To date</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1 w-[160px]" />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} shift{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'All' : prettyStatus(s as ShiftStatus)}
              </Chip>
            ))}
          </div>
        </CardContent>
      </Card>

      <ShiftTable title={`Upcoming & today (${upcoming.length})`} rows={upcoming} />
      <ShiftTable title={`Past (${past.length})`} rows={past} />
    </>
  );
}

function ShiftTable({ title, rows }: { title: string; rows: ShiftRow[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={CalendarClock} title="No shifts" description="No shifts match the current filters." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Rider</Th>
                    <Th>Date</Th>
                    <Th>Time</Th>
                    <Th>Zone</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs">{r.rider.name ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.rider.phone ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {fmtDate(r.date + 'T00:00:00', { dateStyle: 'medium' })}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono tabular-nums">
                        {r.startTime} – {r.endTime}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.zoneName ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3 text-muted-foreground" />
                            {r.zoneName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: ShiftStatus }) {
  const map: Record<ShiftStatus, { variant: 'default' | 'success' | 'warning' | 'destructive' | 'muted'; label: string }> =
    {
      BOOKED: { variant: 'default', label: 'Booked' },
      STARTED: { variant: 'warning', label: 'Started' },
      COMPLETED: { variant: 'success', label: 'Completed' },
      MISSED: { variant: 'destructive', label: 'Missed' },
      CANCELLED: { variant: 'muted', label: 'Cancelled' },
    };
  const x = map[status];
  return (
    <Badge variant={x.variant} className="text-[10px]">
      {x.label}
    </Badge>
  );
}

function prettyStatus(s: ShiftStatus): string {
  return { BOOKED: 'Booked', STARTED: 'Started', COMPLETED: 'Completed', MISSED: 'Missed', CANCELLED: 'Cancelled' }[s];
}
