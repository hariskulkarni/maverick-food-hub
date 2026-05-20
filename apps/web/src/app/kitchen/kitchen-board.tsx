'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSSE } from '@/hooks/use-sse';
import { ChefHat, Package, Clock, Printer, AlertTriangle, BellRing, RefreshCw, Wifi, WifiOff, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { KotLine } from './kot-line';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { SoundToggle } from '@/components/sound-toggle';
import { KitchenAttentionBanner } from '@/components/kitchen-attention-banner';

// Four-column board:
//   RECEIVED  → customer just placed it, needs Accept (kitchen or admin can)
//   ACCEPTED  → accepted but not yet started — Start preparing
//   PREPARING → in the kitchen — Mark ready
//   READY     → waiting for rider pickup
const COLUMNS = [
  { key: 'RECEIVED', title: 'New', icon: BellRing },
  { key: 'ACCEPTED', title: 'Accepted', icon: Clock },
  { key: 'PREPARING', title: 'Preparing', icon: ChefHat },
  { key: 'READY', title: 'Ready', icon: Package }
] as const;

export function KitchenBoard({ branchId, channels, multi = false, initial }: { branchId: string; channels?: string[]; multi?: boolean; initial: any[] }) {
  const [orders, setOrders] = useState<any[]>(initial);
  const [now, setNow] = useState(Date.now());
  const [unacked, setUnacked] = useState<Set<string>>(new Set());
  // Snapshot safety net — tracks the last time we successfully pulled the
  // full order list from /api/kitchen/orders. The badge in the header turns
  // amber if the snapshot is older than 30s, which is the operator's hint
  // that real-time may be silently broken (sleep, nginx, network).
  const [lastSyncAt, setLastSyncAt] = useState<number>(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  // Suppresses the chime-on-new-order when the snapshot refresh introduces
  // an order that was already known to the server (e.g. tab returning from
  // sleep). Only true SSE-delivered events should ring the bell.
  const knownOrderIdsRef = useRef<Set<string>>(new Set(initial.map((o: any) => o.id)));

  // Looping kitchen chime — fires every 3s while there are unacknowledged
  // orders. The hook owns the audio element + autoplay-policy graceful fail.
  const chime = useNotificationSound('/sounds/kitchen.mp3', { loop: true, intervalMs: 3000 });
  const chimePlayingRef = useRef(false);

  // 5s tick so the sync indicator updates in near-real time. (Card "Xm
  // ago" text is minute-resolution so this faster tick is functionally
  // a no-op for them.)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, []);

  // Request browser notification permission once on mount — works only after
  // a user gesture in most browsers, but no harm asking here; if it's denied
  // we fall back to the banner + chime alone.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Drive looping chime from the unacked set — start when non-empty, stop
  // when drained. `chimePlayingRef` debounces so we don't re-arm the
  // interval on every render.
  useEffect(() => {
    if (unacked.size > 0 && !chimePlayingRef.current) {
      chime.play();
      chimePlayingRef.current = true;
    } else if (unacked.size === 0 && chimePlayingRef.current) {
      chime.stop();
      chimePlayingRef.current = false;
    }
  }, [unacked, chime]);

  // Also clear the chime if the operator disables the sound toggle while the
  // banner is up — the loop interval is already disarmed inside the hook,
  // we just resync the local ref so re-enabling restarts.
  useEffect(() => {
    if (!chime.enabled) chimePlayingRef.current = false;
  }, [chime.enabled]);

  /**
   * Snapshot refresh — re-fetch the full order list and reconcile it with
   * local state. Called on a 15s interval, on tab-visible, and from the
   * manual Refresh button.
   *
   * If the snapshot surfaces orders we've never seen before, treat them as
   * new arrivals (chime + banner). This is what catches the case where SSE
   * silently dropped (laptop slept, nginx restarted) and a customer placed
   * an order while the kitchen tab was offline.
   *
   * If the snapshot is MISSING orders we have locally (someone else
   * accepted/delivered them in another tab or via admin), drop them too.
   */
  const refreshSnapshot = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await fetch('/api/kitchen/orders', { cache: 'no-store' });
      if (!r.ok) return;
      const body = await r.json() as { at: string; orders: any[] };
      const serverIds = new Set<string>(body.orders.map((o) => o.id));
      // Detect arrivals — anything in the snapshot we haven't seen yet.
      const fresh = body.orders.filter((o) => !knownOrderIdsRef.current.has(o.id));
      setOrders(body.orders);
      // Track new ids — for unacked attention we only mark RECEIVED arrivals
      // (the kitchen cares about new customer orders to acknowledge; an
      // ACCEPTED-by-admin already-known order shouldn't re-trigger the bell).
      if (fresh.length > 0) {
        setUnacked((prev) => {
          const next = new Set(prev);
          for (const o of fresh) {
            if (o.status === 'RECEIVED' || o.status === 'ACCEPTED') next.add(o.id);
          }
          return next;
        });
      }
      knownOrderIdsRef.current = serverIds;
      setLastSyncAt(Date.now());
    } catch {
      // Network blip — try again on the next tick.
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  // Periodic snapshot — every 15s. Defends against any silent SSE failure
  // (nginx restart, laptop sleep, mobile data tower hand-off). The SSE
  // path stays the fast path; this is a cheap safety net.
  useEffect(() => {
    const id = setInterval(() => refreshSnapshot(true), 15_000);
    return () => clearInterval(id);
  }, [refreshSnapshot]);

  // Tab visibility — when the kitchen tab comes back to the foreground
  // after being hidden, refresh immediately. This is the single biggest
  // class of "orders disappeared" reports: laptop closed → SSE dies →
  // laptop opened → kitchen sees a stale view. Snap to live on focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSnapshot(true);
    };
    const onFocus = () => refreshSnapshot(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    // Also refresh once on mount so a hard reload after a long stale tab
    // never serves the (already-stale) server-render alone.
    refreshSnapshot(true);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSnapshot]);

  useSSE(`branch:${branchId}:orders`, {
    onMessage: async (e: any) => {
      if (!e.orderId) return;
      // Multi-restaurant: the per-order endpoint is single-branch scoped, so an
      // order from another restaurant in this account would 404. Reconcile via
      // the group-aware kitchen snapshot instead (it spans every branch).
      if (multi) { await refreshSnapshot(true); return; }
      const r = await fetch(`/api/admin/orders/${e.orderId}`);
      if (!r.ok) return;
      const o = await r.json();
      setOrders((prev) => {
        const without = prev.filter((x) => x.id !== o.id);
        // RECEIVED is included so the new-order column populates the instant
        // the customer places — admin no longer has to accept first.
        if (['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) {
          return [...without, o].sort(
            (a, b) => new Date(a.acceptedAt ?? a.placedAt).getTime() - new Date(b.acceptedAt ?? b.placedAt).getTime()
          );
        }
        return without;
      });
      // Update known-ids so the snapshot refresh doesn't redundantly mark
      // this order as "new" 15s later and re-ring the bell.
      knownOrderIdsRef.current.add(o.id);
      setLastSyncAt(Date.now());
      // Attention trigger fires on the FIRST appearance of an order (kind
      // 'order:new', which is what placeOrder publishes) and on the manual
      // RECEIVED→ACCEPTED transition that arrives later. Track the id so we
      // can clear it on Acknowledge.
      if (e.kind === 'order:new' || (e.kind === 'status' && (e.status === 'ACCEPTED' || e.status === 'RECEIVED'))) {
        toast.info(`New order ${o.code}`);
        setUnacked((prev) => {
          const next = new Set(prev);
          next.add(o.id);
          return next;
        });
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('New order — Kitchen', {
              body: `Order ${o.code} needs attention`,
              tag: `kitchen-${o.code}`,
              requireInteraction: true,
              silent: false
            });
          } catch {
            /* notification API can throw in some browsers/contexts */
          }
        }
      }
    }
  });

  // Multi-restaurant realtime: also subscribe to every OTHER branch channel
  // this account manages (besides the primary one useSSE already handles) so a
  // new order at any of them updates the board instantly. Any event reconciles
  // via the group-aware snapshot. The 15s poll remains the safety net.
  const secondaryChannels = useMemo(
    () => (channels ?? []).filter((c) => c !== `branch:${branchId}:orders`),
    [channels, branchId]
  );
  useEffect(() => {
    if (secondaryChannels.length === 0) return;
    if (typeof EventSource === 'undefined') return;
    const sources = secondaryChannels.map((c) => {
      const es = new EventSource(`/api/events?channel=${encodeURIComponent(c)}`);
      es.onmessage = () => { refreshSnapshot(true); };
      return es;
    });
    return () => { for (const es of sources) { try { es.close(); } catch {} } };
  }, [secondaryChannels, refreshSnapshot]);

  function acknowledge() {
    setUnacked(new Set());
  }

  async function transition(id: string, next: string) {
    const r = await fetch(`/api/admin/orders/${id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
    if (!r.ok) toast.error(await r.text());
  }

  return (
    <>
      <KitchenAttentionBanner count={unacked.size} onAcknowledge={acknowledge} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <SyncIndicator lastSyncAt={lastSyncAt} now={now} onRefresh={() => refreshSnapshot(false)} refreshing={refreshing} />
        <SoundToggle enabled={chime.enabled} onToggle={chime.setEnabled} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = orders.filter((o) => o.status === col.key);
        return (
          <section key={col.key}>
            <header className="flex items-center gap-2 mb-3">
              <col.icon className="size-5 text-primary" />
              <h2 className="display text-lg font-semibold">{col.title}</h2>
              <Badge variant="muted">{items.length}</Badge>
            </header>
            <div className="space-y-3">
              {items.length === 0 && <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">No orders here.</div>}
              {items.map((o) => {
                // RECEIVED cards count from placedAt and turn overdue much
                // faster (5 min) because no one has even acknowledged the
                // order yet — a stale RECEIVED is a customer waiting blind.
                // ACCEPTED/PREPARING use the existing 25-min overdue rule.
                const startedAt = o.acceptedAt ? new Date(o.acceptedAt).getTime() : new Date(o.placedAt).getTime();
                const min = Math.floor((now - startedAt) / 60_000);
                const overdue =
                  (o.status === 'RECEIVED' && min > 5) ||
                  ((o.status === 'PREPARING' || o.status === 'ACCEPTED') && min > 25);
                return (
                  <Card key={o.id} className={overdue ? 'border-destructive ring-2 ring-destructive/30' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono font-semibold text-base">{o.code}</div>
                          <div className="text-xs text-muted-foreground">{o.customer.name}</div>
                        </div>
                        <div className={`text-sm font-medium ${overdue ? 'text-destructive' : ''}`}>
                          {overdue && <AlertTriangle className="inline size-4 mr-1" />}
                          {min}m
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {o._label && (
                          <Badge variant="secondary" className="font-medium">{o._label.restaurantName}</Badge>
                        )}
                        <FulfillmentBadge type={o.fulfillmentType} />
                        {o.scheduledFor && (
                          <Badge variant="muted">🕒 {fmtSlot(o.scheduledFor)}</Badge>
                        )}
                        {o.fulfillmentType === 'PICKUP' && o.pickupCode && (
                          <Badge variant="muted" className="font-mono">Code {o.pickupCode}</Badge>
                        )}
                        {(() => {
                          const gift = (o.items ?? []).find((i: any) => i.isFreebie);
                          return gift ? (
                            <Badge variant="muted" className="text-success">
                              <Gift className="size-3 mr-1" /> Free: {gift.name}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      <ul className="mt-3 text-sm space-y-1">
                        {o.items.map((i: any) => (
                          <KotLine
                            key={i.id}
                            name={i.name}
                            quantity={i.quantity}
                            comboBreakdown={i.comboBreakdown}
                          />
                        ))}
                      </ul>
                      {o.customerNotes && <p className="mt-2 text-xs text-warning bg-warning/10 rounded p-2">⚠ {o.customerNotes}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {o.status === 'RECEIVED' && (
                          <Button size="sm" onClick={() => transition(o.id, 'ACCEPTED')}>Accept order</Button>
                        )}
                        {o.status === 'ACCEPTED' && <Button size="sm" onClick={() => transition(o.id, 'PREPARING')}>Start preparing</Button>}
                        {o.status === 'PREPARING' && <Button size="sm" onClick={() => transition(o.id, 'READY')}>Mark ready</Button>}
                        <Button size="sm" variant="outline" asChild><a href={`/api/admin/orders/${o.id}/kot`} target="_blank" rel="noreferrer"><Printer className="size-4" /> KOT</a></Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>
    </>
  );
}

/** Fulfillment type pill — DELIVERY is the default and shown for parity. */
function FulfillmentBadge({ type }: { type?: string | null }) {
  const map: Record<string, string> = {
    DELIVERY: '🛵 Delivery',
    PICKUP: '🥡 Pickup',
    DINE_IN: '🍽️ Dine-in'
  };
  return <Badge variant="muted">{map[type ?? 'DELIVERY'] ?? '🛵 Delivery'}</Badge>;
}

/** Format a scheduled slot as a short local time, e.g. "Scheduled 7:30 PM". */
function fmtSlot(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Scheduled ${time}` : `Scheduled ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * Real-time-sync confidence pill. Reads green when we received a snapshot
 * or SSE event in the last 30s; amber when stale (something is wrong);
 * also offers a manual Refresh button so the operator can force a snapshot
 * if they suspect drift.
 */
function SyncIndicator({
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
