'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { useSSE } from '@/hooks/use-sse';
import { money, fmtDate, STATUS_LABELS } from '@/lib/utils';
import { Printer, X, Check, Bike, Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { playNewOrderChime } from '@/lib/audio-cues';
// AssignRiderDialog removed — riders self-claim from the platform pool now.

type Order = any;

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'PENDING', label: 'Pending', match: (o: any) => o.status === 'RECEIVED' },
  { key: 'PREPARING', label: 'Preparing', match: (o: any) => ['ACCEPTED', 'PREPARING', 'READY'].includes(o.status) },
  { key: 'OUT', label: 'Out for delivery', match: (o: any) => o.status === 'OUT_FOR_DELIVERY' },
  { key: 'COMPLETED', label: 'Completed', match: (o: any) => o.status === 'DELIVERED' },
  { key: 'CANCELLED', label: 'Cancelled', match: (o: any) => o.status === 'CANCELLED' },
  { key: 'COD', label: 'COD', match: (o: any) => o.paymentMethod === 'COD' },
  { key: 'ONLINE', label: 'Online paid', match: (o: any) => o.paymentMethod === 'RAZORPAY' }
] as const;

const SOUND_PREF_KEY = 'orders-board:sound-enabled';

type PendingAlert = { orderId: string; code: string };

export function OrdersBoard({ branchId, initial }: { branchId: string; initial: Order[] }) {
  const [orders, setOrders] = useState<Order[]>(initial);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  // Load sound preference & request notification permission once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(SOUND_PREF_KEY);
    if (stored != null) setSoundOn(stored === '1');
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SOUND_PREF_KEY, soundOn ? '1' : '0');
  }, [soundOn]);

  function fireAlert(code: string) {
    if (soundOnRef.current) playNewOrderChime();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('New order', { body: `Order ${code} just came in`, tag: `order-${code}` });
      } catch {
        /* notification API can throw in some browsers/contexts */
      }
    }
  }

  // Re-fire the alert every 30s for any order still pending acknowledgement
  // AND still in RECEIVED status.
  useEffect(() => {
    if (alerts.length === 0) return;
    const t = setInterval(() => {
      // Drop alerts for orders that have already been accepted / moved on.
      setAlerts((prev) => prev.filter((a) => {
        const o = orders.find((x) => x.id === a.orderId);
        return o ? o.status === 'RECEIVED' : true;
      }));
      for (const a of alerts) {
        const o = orders.find((x) => x.id === a.orderId);
        if (!o || o.status === 'RECEIVED') fireAlert(a.code);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [alerts, orders]);

  useSSE(`branch:${branchId}:orders`, {
    onMessage: async (e: any) => {
      // Refetch the affected order on any event for simplicity
      if (!e.orderId) return;
      const r = await fetch(`/api/admin/orders/${e.orderId}`);
      if (!r.ok) return;
      const updated = await r.json();
      setOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [updated, ...prev];
      });
      if (e.kind === 'order:new') {
        toast.info(`New order ${updated.code}`);
        fireAlert(updated.code);
        setAlerts((prev) => prev.some((a) => a.orderId === updated.id) ? prev : [...prev, { orderId: updated.id, code: updated.code }]);
      }
    }
  });

  // If an alerted order is accepted (or otherwise leaves RECEIVED), auto-clear its banner.
  useEffect(() => {
    setAlerts((prev) => prev.filter((a) => {
      const o = orders.find((x) => x.id === a.orderId);
      return !o || o.status === 'RECEIVED';
    }));
  }, [orders]);

  function dismissAlert(orderId: string) {
    setAlerts((prev) => prev.filter((a) => a.orderId !== orderId));
  }

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    if (!f || filter === 'all') return orders;
    return orders.filter((o) => (f as any).match(o));
  }, [orders, filter]);

  async function transition(id: string, next: string, opts: { note?: string } = {}) {
    if (busy[id]) return; // guard against rapid double-clicks
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fetch(`/api/admin/orders/${id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next, note: opts.note }) });
      if (!r.ok) toast.error('Failed: ' + (await r.text()));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  return (
    <>
      {alerts.length > 0 && (
        <div className="sticky top-0 z-30 -mx-6 mb-2 space-y-1">
          {alerts.map((a) => (
            <div
              key={a.orderId}
              className="flex items-center justify-between gap-4 bg-destructive px-6 py-3 text-destructive-foreground shadow-lg animate-[pulse_1s_ease-in-out_infinite]"
              role="alert"
              aria-live="assertive"
            >
              <div className="font-semibold">NEW ORDER · {a.code} — please review</div>
              <Button size="sm" variant="secondary" onClick={() => dismissAlert(a.orderId)}>Acknowledge</Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${filter === f.key ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSoundOn((v) => !v)}
          title={soundOn ? 'Sound alerts: on' : 'Sound alerts: off'}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${soundOn ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
        >
          {soundOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-muted-foreground">No orders match this filter.</div>
        )}
        {filtered.map((o) => (
          <Card key={o.id}>
            <CardContent className="p-5 grid gap-4 md:grid-cols-[1fr_auto] items-start">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-primary">{o.code}</Link>
                  <OrderStatusBadge status={o.status} />
                  <span className="text-xs text-muted-foreground">{fmtDate(o.placedAt)}</span>
                </div>
                <div className="text-sm">{o.customer.name ?? o.customer.phone} · {o.address ? `${o.address.line1}, ${o.address.city}` : 'No address'}</div>
                <div className="text-sm text-muted-foreground">{o.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}</div>
                <div className="text-sm">
                  Total <span className="font-semibold">{money(o.total)}</span> · {o.paymentMethod}
                  {o.assignment?.rider && <> · Rider: {o.assignment.rider.user.name}</>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {o.status === 'RECEIVED' && (
                  <>
                    <Button size="sm" disabled={busy[o.id]} onClick={() => transition(o.id, 'ACCEPTED')}><Check className="size-4" /> Accept</Button>
                    <Button size="sm" variant="outline" disabled={busy[o.id]} onClick={() => transition(o.id, 'CANCELLED', { note: 'Rejected by admin' })}>
                      <X className="size-4" /> Reject
                    </Button>
                  </>
                )}
                {o.status === 'ACCEPTED' && <Button size="sm" disabled={busy[o.id]} onClick={() => transition(o.id, 'PREPARING')}>Start preparing</Button>}
                {o.status === 'PREPARING' && <Button size="sm" disabled={busy[o.id]} onClick={() => transition(o.id, 'READY')}>Mark ready — release to rider pool</Button>}
                {o.status === 'READY' && !o.assignment && (
                  <span className="inline-flex items-center gap-2 rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning font-medium">
                    <Bike className="size-3.5" /> Waiting for a rider to pick this up
                  </span>
                )}
                {o.status === 'READY' && o.assignment && (
                  <span className="inline-flex items-center gap-2 rounded-md bg-success/10 px-3 py-1.5 text-xs text-success font-medium">
                    <Bike className="size-3.5" /> {o.assignment.rider?.user?.name ?? 'Rider'} picked it up
                  </span>
                )}
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/admin/orders/${o.id}/kot`} target="_blank" rel="noreferrer"><Printer className="size-4" /> KOT</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/admin/orders/${o.id}/invoice.pdf`} target="_blank" rel="noreferrer"><Printer className="size-4" /> Invoice</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </>
  );
}
