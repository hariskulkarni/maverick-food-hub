'use client';
/**
 * Masked-call history (rider → customer, via Exotel) for the super-admin order
 * and rider drawers. Reads GET /api/platform/telephony/calls — ids, outcomes
 * and timings only; the API never returns phone numbers.
 */
import { useEffect, useState } from 'react';
import { Loader2, PhoneCall, PhoneOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface CallRow {
  id: string;
  status: string;
  durationSec: number | null;
  createdAt: string;
  riderLegStatus: string | null;
  customerLegStatus: string | null;
  failureReason: string | null;
  order: { id: string; code: string };
  rider: { id: string; name: string | null };
}

const LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  QUEUED: 'Ringing rider',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Connected',
  BUSY: 'Busy',
  NO_ANSWER: 'No answer',
  FAILED: 'Failed',
  CANCELED: 'Cancelled',
};
const VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  COMPLETED: 'success',
  BUSY: 'warning',
  NO_ANSWER: 'warning',
  FAILED: 'destructive',
  CANCELED: 'muted',
};

function fmtDuration(s: number | null): string | null {
  if (s == null) return null;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function CallLogBlock({ orderId, riderId }: { orderId?: string; riderId?: string }) {
  const [state, setState] = useState<{ loading: boolean; calls: CallRow[]; error: boolean }>({ loading: true, calls: [], error: false });
  const qs = orderId ? `orderId=${encodeURIComponent(orderId)}` : `riderId=${encodeURIComponent(riderId ?? '')}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/platform/telephony/calls?${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setState({ loading: false, calls: j.calls ?? [], error: false }); })
      .catch(() => { if (!cancelled) setState({ loading: false, calls: [], error: true }); });
    return () => { cancelled = true; };
  }, [qs]);

  if (state.loading) return <div className="p-4 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  if (state.error) return <div className="p-4 text-sm text-destructive">Could not load call history.</div>;
  if (state.calls.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><PhoneOff className="size-4" /> No masked calls yet.</div>;
  }
  return (
    <ul className="divide-y text-sm">
      {state.calls.map((c) => (
        <li key={c.id} className="p-3 flex items-start gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0"><PhoneCall className="size-4" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">
              {orderId ? (c.rider.name ?? 'Rider') : <span className="font-mono">{c.order.code}</span>} → customer
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              {fmtDuration(c.durationSec) ? ` · talk ${fmtDuration(c.durationSec)}` : ''}
              {c.riderLegStatus || c.customerLegStatus ? ` · rider ${c.riderLegStatus ?? '—'} / customer ${c.customerLegStatus ?? '—'}` : ''}
            </div>
            {c.failureReason && <div className="text-[10px] text-destructive break-words">{c.failureReason}</div>}
          </div>
          <Badge variant={VARIANT[c.status] ?? 'muted'} className="text-[10px] shrink-0">{LABEL[c.status] ?? c.status}</Badge>
        </li>
      ))}
    </ul>
  );
}
