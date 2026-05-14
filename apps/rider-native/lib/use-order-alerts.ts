/**
 * useOrderAlerts — detects newly-appeared pool orders between renders.
 *
 * Feed it the current pool order array; it diffs by `orderId` against the
 * previous render. When previously-unseen orders show up, it fires a haptic
 * pulse and bumps `newCount` so the screen can surface a banner. `clear()`
 * resets the count (e.g. when the rider taps or the banner auto-dismisses).
 *
 * Haptics only — no audio. The very first render is treated as a baseline so
 * the rider isn't buzzed for the orders that were already in the pool.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import type { PoolOrder } from './api';

export interface OrderAlerts {
  /** How many brand-new orders have appeared since the last clear(). */
  newCount: number;
  /** Reset newCount back to zero. */
  clear: () => void;
}

export function useOrderAlerts(orders: PoolOrder[]): OrderAlerts {
  const [newCount, setNewCount] = useState(0);
  // Ids seen on the previous render. null === first render (baseline only).
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = orders.map((o) => o.orderId);

    if (seenIds.current === null) {
      // First render — establish the baseline, don't alert.
      seenIds.current = new Set(currentIds);
      return;
    }

    const prev = seenIds.current;
    const freshIds = currentIds.filter((id) => !prev.has(id));

    if (freshIds.length > 0) {
      setNewCount((c) => c + freshIds.length);
      // Fire-and-forget; haptics failing (e.g. unsupported device) is harmless.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {}
      );
    }

    seenIds.current = new Set(currentIds);
  }, [orders]);

  const clear = useCallback(() => setNewCount(0), []);

  return { newCount, clear };
}
