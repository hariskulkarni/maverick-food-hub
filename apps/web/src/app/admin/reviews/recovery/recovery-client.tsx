'use client';
/**
 * Service-recovery tickets opened by low ratings. Staff reach out (call /
 * WhatsApp), keep notes, assign an owner and record any goodwill gesture.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Phone, MessageCircle, Star, Clock, Bike, ShieldCheck, Save, Printer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { reportApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

type Status = 'OPEN' | 'CONTACTED' | 'RESOLVED';
interface Ticket {
  id: string;
  status: Status;
  rating: number;
  comment: string | null;
  notes: string | null;
  goodwillNote: string | null;
  goodwillAt: string | null;
  assigneeUserId: string | null;
  createdAt: string;
  source: 'order' | 'qr';
  customer: { name: string | null; phone: string | null };
  order: null | {
    id: string; code: string; fulfillmentType: string; total: number;
    placedAt: string; readyAt: string | null; deliveredAt: string | null; estimatedDeliveryAt: string | null;
    minutesLate: number | null; riderName: string | null;
    items: { name: string; quantity: number }[]; issueTags: string[];
    ratings: { food: number | null; delivery: number | null; overall: number | null } | null;
  };
}
interface Staff { id: string; name: string }

const FILTERS: { id: Status | 'ALL'; label: string }[] = [
  { id: 'OPEN', label: 'Open' }, { id: 'CONTACTED', label: 'Contacted' }, { id: 'RESOLVED', label: 'Resolved' }, { id: 'ALL', label: 'All' },
];
const STATUS_TONE: Record<Status, string> = { OPEN: 'bg-destructive/10 text-destructive', CONTACTED: 'bg-warning/15 text-warning', RESOLVED: 'bg-success/10 text-success' };
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—');
const tag = (t: string) => t.toLowerCase().replace(/_/g, ' ');

export function waLink(phone: string): string {
  const d = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}

export function RecoveryClient() {
  const [filter, setFilter] = useState<Status | 'ALL'>('OPEN');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/recovery${filter === 'ALL' ? '' : `?status=${filter}`}`, { cache: 'no-store' });
    if (!r.ok) { await reportApiError(r, 'Could not load tickets'); return; }
    const d = await r.json();
    setTickets(d.tickets);
    setStaff(d.staff);
  }, [filter]);
  useEffect(() => { setTickets(null); load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display text-2xl font-semibold">Service recovery</h1>
          <p className="text-sm text-muted-foreground">Low ratings open a ticket here so you can reach out and make it right.</p>
        </div>
        <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
          <Link href="/admin/reviews/kit"><Printer className="size-3.5" /> Review QR kit</Link>
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        Any refund, replacement or goodwill gesture must be unconditional. Never ask a customer to change, remove or
        write a review in exchange for it. These customers saw the same Google review link as everyone else.
      </p>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
            className={cn('h-10 rounded-full border px-4 text-sm', filter === f.id ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>
            {f.label}
          </button>
        ))}
      </div>

      {tickets === null ? (
        <div className="h-32 rounded-2xl border bg-muted/20 shimmer" />
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets" description="Nothing to follow up on right now." />
      ) : (
        <div className="grid gap-3">
          {tickets.map((t) => (
            <TicketCard key={t.id} t={t} staff={staff} onChanged={(n) => setTickets((all) => (all ?? []).map((x) => (x.id === n.id ? { ...x, ...n } : x)))} />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketCard({ t, staff, onChanged }: { t: Ticket; staff: Staff[]; onChanged: (n: Partial<Ticket> & { id: string }) => void }) {
  const [notes, setNotes] = useState(t.notes ?? '');
  const [goodwill, setGoodwill] = useState(t.goodwillNote ?? '');
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/recovery/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { await reportApiError(r, 'Update failed'); return; }
      const d = await r.json();
      onChanged(d.ticket);
      toast.success(ok);
    } finally {
      setBusy(false);
    }
  }

  const o = t.order;
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-0.5" aria-label={`${t.rating} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn('size-4', n <= t.rating ? 'fill-warning text-warning' : 'text-muted-foreground/30')} />)}
          </span>
          <span className="font-semibold">{o ? `Order ${o.code}` : 'QR feedback'}</span>
          <Badge className={STATUS_TONE[t.status]}>{t.status.toLowerCase()}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">{fmt(t.createdAt)}</span>
        </div>

        {t.comment && <p className="rounded-lg bg-muted/40 p-3 text-sm">“{t.comment}”</p>}

        {o && (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Items</div>
              <div>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ') || '—'}</div>
              {o.issueTags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">{o.issueTags.map((x) => <Badge key={x} variant="outline">{tag(x)}</Badge>)}</div>
              )}
            </div>
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-muted-foreground">Timing</div>
              <div className="flex items-center gap-1.5"><Clock className="size-3.5" /> Placed {fmt(o.placedAt)}</div>
              <div>{o.fulfillmentType === 'DELIVERY' ? 'Delivered' : 'Handed over'} {fmt(o.deliveredAt)}</div>
              {o.fulfillmentType === 'DELIVERY' && (
                <div className={cn(o.minutesLate ? 'text-destructive' : 'text-muted-foreground')}>
                  {o.minutesLate ? `${o.minutesLate} min later than promised` : o.estimatedDeliveryAt ? 'On time' : 'No ETA recorded'}
                </div>
              )}
              {o.riderName && <div className="flex items-center gap-1.5"><Bike className="size-3.5" /> {o.riderName}</div>}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-sm">{t.customer.name ?? 'Customer'}</span>
          {t.customer.phone ? (
            <>
              <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
                <a href={`tel:${t.customer.phone}`}><Phone className="size-3.5" /> Call</a>
              </Button>
              <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
                <a href={waLink(t.customer.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-3.5" /> WhatsApp</a>
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No phone number shared</span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`st-${t.id}`}>Status</Label>
            <select id={`st-${t.id}`} disabled={busy} value={t.status} onChange={(e) => patch({ status: e.target.value }, 'Status updated')}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="OPEN">Open</option>
              <option value="CONTACTED">Contacted</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`as-${t.id}`}>Assignee</Label>
            <select id={`as-${t.id}`} disabled={busy} value={t.assigneeUserId ?? ''} onChange={(e) => patch({ assigneeUserId: e.target.value || null }, 'Assignee updated')}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`nt-${t.id}`}>Notes (internal)</Label>
          <Textarea id={`nt-${t.id}`} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Called, apologised, kitchen briefed…" />
          <Button size="sm" variant="outline" disabled={busy || notes === (t.notes ?? '')} onClick={() => patch({ notes }, 'Notes saved')} className="w-full sm:w-auto">
            <Save className="size-3.5" /> Save notes
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`gw-${t.id}`}>Goodwill gesture (unconditional)</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={`gw-${t.id}`} maxLength={500} value={goodwill} onChange={(e) => setGoodwill(e.target.value)} placeholder="e.g. Refunded the cold biryani" />
            <Button size="sm" variant="outline" disabled={busy || goodwill === (t.goodwillNote ?? '')} onClick={() => patch({ goodwillNote: goodwill }, 'Goodwill note saved')} className="w-full sm:w-auto">
              Record
            </Button>
          </div>
          {t.goodwillAt && <p className="text-[11px] text-muted-foreground">Recorded {fmt(t.goodwillAt)}. Offered regardless of any review.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
