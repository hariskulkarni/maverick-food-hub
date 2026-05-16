/**
 * useBatchInvitations — polls /api/rider/batch-invitations every 3 seconds
 * while the rider is online, surfaces the first PENDING invitation, and
 * exposes accept/decline wrappers.
 *
 * Polling cadence is intentionally faster than the pool watcher (3s vs. 10s)
 * because batch invitations have a 15-second TTL — we need at least a few
 * ticks of visibility before they expire. A push notification also fires
 * from the server, but we don't rely on it — push delivery is best-effort.
 *
 * Only ever returns ONE invitation at a time. If the API returns multiple,
 * we take the earliest and let the others wait their turn (rare in practice
 * since the dispatcher sends them serially per rider).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BatchInvitation } from './api';

const POLL_MS = 3_000;

export interface BatchInvitationsApi {
  /** The single oldest PENDING invitation, or null if none. */
  current: BatchInvitation | null;
  /** Accept the invitation. Resolves when the server confirms. */
  accept: (id: string) => Promise<void>;
  /** Decline the invitation. Best-effort; clears `current` regardless. */
  decline: (id: string, reason?: string) => Promise<void>;
}

/**
 * @param enabled  Pass `true` only when the rider is authenticated AND online.
 *                 Toggling to false stops the poll and clears the current row.
 */
export function useBatchInvitations(enabled: boolean): BatchInvitationsApi {
  const [current, setCurrent] = useState<BatchInvitation | null>(null);
  // Latch the id of the row we last surfaced; if the API stops returning it
  // (server cancelled / expired) we clear the modal so the rider isn't stuck
  // looking at a dead countdown.
  const surfacedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      surfacedIdRef.current = null;
      setCurrent(null);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      let list: BatchInvitation[];
      try {
        const res = await api.batchInvitations();
        list = res.invitations ?? [];
      } catch {
        return; // skip this tick, keep polling
      }
      if (cancelled) return;

      const next = list.length > 0 ? list[0] : null;
      // If the previously-surfaced row is gone (timed out server-side, sibling
      // accepted, rider declined elsewhere), clear it.
      if (!next) {
        surfacedIdRef.current = null;
        setCurrent(null);
        return;
      }
      // Same row as last tick → refresh state so secondsLeft ticks down.
      // Different row → swap to the new one.
      surfacedIdRef.current = next.id;
      setCurrent(next);
    };

    tick();
    const id = setInterval(tick, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  const accept = useCallback(async (id: string) => {
    try {
      await api.acceptBatchInvitation(id);
    } finally {
      // Whether the API said 409 or 200, the modal should close — either we
      // got the order or the chance has passed. The next poll will reconcile.
      surfacedIdRef.current = null;
      setCurrent(null);
    }
  }, []);

  const decline = useCallback(async (id: string, reason?: string) => {
    try {
      await api.declineBatchInvitation(id, reason);
    } catch {
      // Swallow — the server will EXPIRE it within ~15s anyway.
    } finally {
      surfacedIdRef.current = null;
      setCurrent(null);
    }
  }, []);

  return { current, accept, decline };
}
