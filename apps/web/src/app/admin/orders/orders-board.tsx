'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { useSSE } from '@/hooks/use-sse';
import { money, fmtDate } from '@/lib/utils';
import { Printer, X, Check, Bike, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { SoundToggle } from '@/components/sound-toggle';
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

type PendingAlert = { orderId: string; code: string };

export function OrdersBoard({ branchId, initial }: { branchId: string; initial: Order[] }) {
  const [orders, setOrders] = useState<Order[]>(initial);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  // Sync safety net — tracks last successful pull from /api/admin/orders/snapshot.
  // Triggers the amber "Synced Xs ago" pill in the header when stale.
  const [lastSyncAt, setLastSyncAt] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  // Known-ids: orders we've already surfaced through SSE or a prior snapshot,
  // so the periodic snapshot doesn't re-fire the chime for already-known
  // orders. Both SSE and snapshot paths add to this set.
  const knownOrderIdsRef = useRef<Set<string>>(new Set(initial.map((o) => o.id)));

  // Admin gets a single soft chime per new order — kitchen owns the looping
  // attention loop. Pref is persisted by the hook under `notif-sound-admin.mp3`.
  const chime = useNotificationSound('/sounds/admin.mp3', { loop: false });

  // Request browser notification permission once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  function fireAlert(code: string) {
    chime.play();
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

  /**
   * Snapshot refresh — re-fetch the full order list and reconcile state.
   * Same safety-net pattern as the kitchen board: defends against SSE
   * silently dropping (laptop sleep, nginx restart, network blip). Fires
   * the chime ONLY for orders we hadn't seen before, so the snapshot poll
   * never double-rings on already-known orders.
   */
  const refreshSnapshot = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await fetch('/api/admin/orders/snapshot', { cache: 'no-store' });
      if (!r.ok) return;
      const body = await r.json() as { at: string; orders: Order[] };
      const fresh = body.orders.filter((o: Order) => !knownOrderIdsRef.current.has(o.id));
      setOrders(body.orders);
      if (fresh.length > 0) {
        // Surface arrivals discovered via snapshot (vs SSE). Only RECEIVED
        // qualifies for the persistent alert banner — already-accepted
        // orders shouldn't pop the admin's attention loop.
        for (const o of fresh) {
          if (o.status === 'RECEIVED') {
            fireAlert(o.code);
            setAlerts((prev) =>
              prev.some((a) => a.orderId === o.id)
                ? prev
                : [...prev, { orderId: o.id, code: o.code }]
            );
          }
        }
      }
      knownOrderIdsRef.current = new Set(body.orders.map((o: Order) => o.id));
      setLastSyncAt(Date.now());
    } catch {
      /* swallow — try again on the next tick */
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  // Periodic snapshot — every 15s. Safety net for any silent SSE failure.
  useEffect(() => {
    const id = setInterval(() => refreshSnapshot(true), 15_000);
    return () => clearInterval(id);
  }, [refreshSnapshot]);

  // Tab visibility — refresh the instant admin returns to the foreground.
  // Defends against the #1 "orders disappeared" report: tab was hidden /
  // laptop was asleep / browser killed the EventSource silently.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSnapshot(true);
    };
    const onFocus = () => refreshSnapshot(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    // Also do a snapshot on mount so a hard reload after a long stale tab
    // never serves the SSR result alone.
    refreshSnapshot(true);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSnapshot]);

  // Tick every 5s so the sync-indicator pill updates in near-real time.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

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
      // Mark known + bump sync so the indicator stays green even when SSE
      // is doing all the work and snapshots aren't strictly needed.
      knownOrderIdsRef.current.add(updated.id);
      setLastSyncAt(Date.now());
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
        <div className="ml-auto flex items-center gap-2">
          <AdminSyncIndicator lastSyncAt={lastSyncAt} now={nowTick} onRefresh={() => refreshSnapshot(false)} refreshing={refreshing} />
          <SoundToggle enabled={chime.enabled} onToggle={chime.setEnabled} />
        </div>
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-muted-foreground">No orders match this filter.</div>
        )}
        {filtered.map((o) => (
          <Card key={o.id}>
            <CardContent className="p-5 grid gap-4 md:grid-cols-[1fr_auto] items-start">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-primary">{o.code}</Link>
                  <OrderStatusBadge status={o.status} />
                  <FulfillmentPill type={o.fulfillmentType} />
                  {o.scheduledFor && (
                    <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium">🕒 {fmtSlot(o.scheduledFor)}</span>
                  )}
                  {o.fulfillmentType === 'PICKUP' && o.pickupCode && (
                    <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px] font-mono font-medium">Code {o.pickupCode}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{fmtDate(o.placedAt)}</span>
                </div>
                <div className="text-sm">{o.customer.name ?? o.customer.phone} · {o.address ? `${o.address.line1}, ${o.address.city}` : (o.fulfillmentType === 'PICKUP' ? 'Self-pickup' : o.fulfillmentType === 'DINE_IN' ? 'Dine-in' : 'No address')}</div>
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

/** Fulfillment type pill for the admin order card. */
function FulfillmentPill({ type }: { type?: string | null }) {
  const map: Record<string, string> = {
    DELIVERY: '🛵 Delivery',
    PICKUP: '🥡 Pickup',
    DINE_IN: '🍽️ Dine-in'
  };
  return <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium">{map[type ?? 'DELIVERY'] ?? '🛵 Delivery'}</span>;
}

/** Short scheduled-slot label, e.g. "Scheduled 7:30 PM". */
function fmtSlot(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Scheduled ${time}` : `Scheduled ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * Real-time sync confidence pill for the admin orders board. Green "Live"
 * if the last snapshot/SSE update was within 30s; amber "Synced Xs ago"
 * with a WifiOff icon otherwise. Includes a manual Refresh button.
 */
function AdminSyncIndicator({
  lastSyncAt,
  now,
  onRefresh,
  refreshing,
}: {
  lastSyncAt: number;
  now: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const seconds = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
  const stale = seconds > 30;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
          stale
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-success/40 bg-success/10 text-success'
        }`}
        title={stale ? 'Real-time sync may be delayed' : 'Live'}
      >
        {stale ? <WifiOff className="size-3" /> : <Wifi className="size-3" />}
        {stale ? `Synced ${seconds}s ago` : 'Live'}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={refreshing}
        className="h-7 px-2 text-xs"
        title="Force refresh"
      >
        <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
        <span className="ml-1">Refresh</span>
      </Button>
    </div>
  );
}
