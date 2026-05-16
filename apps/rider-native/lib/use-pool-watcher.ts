/**
 * usePoolWatcher — background poller that surfaces brand-new pool orders.
 *
 * Polls GET /api/rider/pool every 10s while the rider is ONLINE, diffs the
 * latest tick's orderIds against a ref-tracked "seen" set, and exposes the
 * single freshest brand-new order as `newOrder`. The screen mounts the
 * IncomingOrderPopup with that order; on dismiss/view it calls `ack()` which
 * clears `newOrder` so the popup unmounts (but the seen set keeps the order
 * id so we never re-pop the same one).
 *
 * The first poll establishes a baseline — we don't pop a popup for orders
 * that were already sitting in the pool when the rider went online (they'll
 * see them naturally in the Orders tab).
 *
 * If polling fails (network blip, server down), we just skip the tick and
 * try again next interval — the rider sees a stale list but no error toast,
 * since the dashboard / pool screens already surface API errors.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, type PoolOrder } from './api';

const POLL_MS = 10_000;

export interface PoolWatcher {
  /** The brand-new pool order to popup (or null when nothing pending). */
  newOrder: PoolOrder | null;
  /** Clear `newOrder` once the popup has been dismissed or viewed. */
  ack: () => void;
}

/**
 * @param enabled  Pass `true` when the rider is authenticated AND online.
 *                 Toggling to false stops the poll and clears any pending
 *                 popup so we don't surface stale orders after going offline.
 */
export function usePoolWatcher(enabled: boolean): PoolWatcher {
  const [newOrder, setNewOrder] = useState<PoolOrder | null>(null);
  // null === baseline not yet established (first tick will set it).
  const seenIdsRef = useRef<Set<string> | null>(null);
  // Stash pending freshly-seen orders so if multiple appear in one tick we
  // show them one at a time (FIFO) — pop the next on ack().
  const queueRef = useRef<PoolOrder[]>([]);

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    setNewOrder(next);
  }, []);

  const ack = useCallback(() => {
    advance();
  }, [advance]);

  useEffect(() => {
    if (!enabled) {
      // Going offline / signing out — reset everything.
      seenIdsRef.current = null;
      queueRef.current = [];
      setNewOrder(null);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      let orders: PoolOrder[];
      try {
        orders = await api.pool();
      } catch {
        return; // skip this tick, keep polling
      }
      if (cancelled) return;

      if (seenIdsRef.current === null) {
        // First successful poll — baseline only, don't alert.
        seenIdsRef.current = new Set(orders.map((o) => o.orderId));
        return;
      }

      const seen = seenIdsRef.current;
      const freshlyAppeared: PoolOrder[] = [];
      for (const o of orders) {
        if (!seen.has(o.orderId)) {
          freshlyAppeared.push(o);
          seen.add(o.orderId);
        }
      }

      if (freshlyAppeared.length > 0) {
        // Append to queue; if nothing showing right now, pop the first.
        queueRef.current.push(...freshlyAppeared);
        setNewOrder((current) => current ?? queueRef.current.shift() ?? null);
      }
    };

    // Kick off immediately so the baseline is established without a 10s wait.
    tick();
    const id = setInterval(tick, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return { newOrder, ack };
}
