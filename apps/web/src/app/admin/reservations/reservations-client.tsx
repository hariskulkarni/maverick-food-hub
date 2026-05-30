'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { CalendarClock, Check, Armchair, CircleCheck, UserX, X } from 'lucide-react';

type Status = 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

interface Reservation {
  id: string;
  code: string;
  partySize: number;
  reservedAt: string;
  durationMin: number;
  status: Status;
  depositAmount: number;
  depositPaid: boolean;
  discountPct: number;
  customerNotes: string | null;
  table: { id: string; name: string; capacity: number } | null;
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
}

const STATUS_BADGE: Record<Status, 'default' | 'success' | 'warning' | 'destructive' | 'muted' | 'secondary'> = {
  PENDING: 'warning',
  CONFIRMED: 'default',
  SEATED: 'secondary',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  NO_SHOW: 'destructive'
};

const FILTERS: Array<{ key: 'ALL' | Status; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'SEATED', label: 'Seated' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'NO_SHOW', label: 'No-show' }
];

export function ReservationsClient({
  dineInEnabled, initial
}: { dineInEnabled: boolean; initial: Reservation[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<'ALL' | Status>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () => (filter === 'ALL' ? initial : initial.filter((r) => r.status === filter)),
    [filter, initial]
  );

  async function act(id: string, action: 'confirm' | 'seat' | 'complete' | 'noshow' | 'cancel') {
    let reason: string | undefined;
    if (action === 'cancel') {
      reason = window.prompt('Reason for cancellation (optional)') ?? undefined;
    }
    setBusyId(id);
    try {
      const r = await fetch(`/api/admin/reservations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      });
      if (!r.ok) { await reportApiError(r, 'Action failed'); return; }
      toast.success('Reservation updated');
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <CalendarClock className="size-5" />
        </div>
        <div>
          <h1 className="display text-2xl font-semibold">Reservations</h1>
          <p className="text-sm text-muted-foreground">Upcoming dine-in bookings for this branch.</p>
        </div>
      </header>

      {!dineInEnabled && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Dine-in reservations are turned off. Enable them in <span className="font-medium">Settings → Order flow</span>.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((ff) => (
          <Button
            key={ff.key}
            size="sm"
            variant={filter === ff.key ? 'default' : 'ghost'}
            onClick={() => setFilter(ff.key)}
          >
            {ff.label}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="p-0">
          <EmptyState icon={CalendarClock} title="No reservations" description="Bookings will appear here as customers reserve tables." />
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{r.code}</span>
                    <Badge variant={STATUS_BADGE[r.status]}>{r.status.replace('_', '-').toLowerCase()}</Badge>
                    {r.depositPaid && <Badge variant="success">deposit paid</Badge>}
                  </div>
                  <div className="text-sm">
                    {r.customer?.name ?? 'Guest'}
                    {r.customer?.phone && <span className="text-muted-foreground"> · {r.customer.phone}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmt(r.reservedAt)} · party of {r.partySize} · {r.table ? `table ${r.table.name}` : 'no table'} · {r.durationMin} min
                    {r.depositAmount > 0 && ` · ₹${r.depositAmount} deposit`}
                  </div>
                  {r.customerNotes && <div className="text-xs italic text-muted-foreground">“{r.customerNotes}”</div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(r.status === 'PENDING') && (
                    <Action onClick={() => act(r.id, 'confirm')} busy={busyId === r.id} icon={Check}>Confirm</Action>
                  )}
                  {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                    <Action onClick={() => act(r.id, 'seat')} busy={busyId === r.id} icon={Armchair}>Seat</Action>
                  )}
                  {r.status === 'SEATED' && (
                    <Action onClick={() => act(r.id, 'complete')} busy={busyId === r.id} icon={CircleCheck}>Complete</Action>
                  )}
                  {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                    <Action onClick={() => act(r.id, 'noshow')} busy={busyId === r.id} icon={UserX}>No-show</Action>
                  )}
                  {r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW' && (
                    <Action onClick={() => act(r.id, 'cancel')} busy={busyId === r.id} icon={X} danger>Cancel</Action>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Action({
  onClick, busy, icon: Icon, danger, children
}: { onClick: () => void; busy: boolean; icon: any; danger?: boolean; children: React.ReactNode }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={busy} className={danger ? 'text-destructive' : ''}>
      <Icon className="size-4" /> {children}
    </Button>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
  });
}
