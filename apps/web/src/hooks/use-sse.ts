'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to a server channel and yields the latest event.
 *
 * Primary transport: SSE via `/api/events?channel=...`.
 *
 * Fallback to polling `/api/events/poll?channel=...&since=<iso>` if:
 *   - the EventSource emits >= 3 errors within 30 seconds, OR
 *   - the EventSource readyState stays CLOSED for > 10 seconds.
 *
 * Once we fall back, we stop trying SSE for the lifetime of the channel —
 * cheap hosting / nginx-without-proxy_buffering-off won't suddenly improve.
 * Caller signature is unchanged.
 */
export function useSSE<T = unknown>(channel: string | null, opts: { onMessage?: (event: T) => void } = {}) {
  const [last, setLast] = useState<T | null>(null);
  const onMsg = useRef(opts.onMessage);
  onMsg.current = opts.onMessage;

  useEffect(() => {
    if (!channel) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let closedSinceTimer: ReturnType<typeof setTimeout> | null = null;
    let mode: 'sse' | 'polling' = 'sse';
    const errorTimes: number[] = [];
    let lastSince = new Date().toISOString();

    const deliver = (data: T) => {
      setLast(data);
      onMsg.current?.(data);
    };

    const startPolling = () => {
      if (mode === 'polling' || cancelled) return;
      mode = 'polling';
      if (es) { try { es.close(); } catch {} es = null; }
      if (closedSinceTimer) { clearTimeout(closedSinceTimer); closedSinceTimer = null; }

      const tick = async () => {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/events/poll?channel=${encodeURIComponent(channel)}&since=${encodeURIComponent(lastSince)}`, { cache: 'no-store' });
          if (r.ok) {
            const body = await r.json() as { now: string; events: { seq: number; at: string; event: T }[] };
            lastSince = body.now ?? lastSince;
            for (const ev of body.events ?? []) deliver(ev.event);
          }
        } catch {}
        if (!cancelled) pollTimer = setTimeout(tick, 3000);
      };
      tick();
    };

    const armClosedWatchdog = () => {
      if (closedSinceTimer) return;
      closedSinceTimer = setTimeout(() => {
        if (!es) return;
        if (es.readyState === EventSource.CLOSED) startPolling();
        else closedSinceTimer = null; // recovered (CONNECTING/OPEN) — reset latch
      }, 10_000);
    };

    const openSSE = () => {
      es = new EventSource(`/api/events?channel=${encodeURIComponent(channel)}`);
      es.onopen = () => {
        if (closedSinceTimer) { clearTimeout(closedSinceTimer); closedSinceTimer = null; }
      };
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as T;
          deliver(data);
        } catch {}
      };
      es.onerror = () => {
        const now = Date.now();
        errorTimes.push(now);
        // Keep only errors from the last 30s
        while (errorTimes.length > 0 && now - errorTimes[0] > 30_000) errorTimes.shift();
        if (errorTimes.length >= 3) { startPolling(); return; }
        // Otherwise let the browser auto-reconnect, but if it gives up
        // (state stays CLOSED >10s) trigger fallback.
        if (es?.readyState === EventSource.CLOSED) armClosedWatchdog();
      };
    };

    openSSE();

    return () => {
      cancelled = true;
      if (es) { try { es.close(); } catch {} }
      if (pollTimer) clearTimeout(pollTimer);
      if (closedSinceTimer) clearTimeout(closedSinceTimer);
    };
  }, [channel]);

  return last;
}
