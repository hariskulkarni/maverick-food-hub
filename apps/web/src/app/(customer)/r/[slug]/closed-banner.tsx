/**
 * ClosedBanner — sticky warning shown above the menu when the restaurant is
 * outside its operating hours.
 *
 * UX decision: the menu STAYS BROWSABLE because customers may want to
 * pre-order for a future open slot. We add a yellow/amber banner at the top,
 * dim the menu cards (opacity-60), and the checkout flow converts the order
 * to a scheduled-order in the next open window.
 *
 * Props:
 * - label: e.g. "Closed — opens tomorrow at 11:00 AM"
 * - nextChangeAt: when the next open window starts (ISO date string).
 *
 * Rendered as a CLIENT component so we can show a live countdown ("opens in
 * 2h 15m") that updates without a server round-trip. SSR-safe — the initial
 * render uses the label only.
 */
'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  label: string;
  nextChangeAtIso: string | null;
  reason: string;
}

function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return 'now';
  const totalMin = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function ClosedBanner({ label, nextChangeAtIso, reason }: Props) {
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    if (!nextChangeAtIso) return;
    const target = new Date(nextChangeAtIso).getTime();
    const tick = () => setCountdown(formatCountdown(target - Date.now()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nextChangeAtIso]);

  return (
    <div
      role="status"
      className="sticky top-0 z-30 w-full bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800"
      data-closed-reason={reason}
    >
      <div className="container py-2.5 flex items-center gap-2 text-amber-900 dark:text-amber-200">
        <Clock className="size-4 shrink-0" />
        <div className="flex-1 min-w-0 text-sm font-medium truncate">
          {label}
          {countdown && (
            <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-xs">
              in {countdown}
            </span>
          )}
        </div>
        <div className="hidden sm:block text-xs text-amber-700 dark:text-amber-400 shrink-0">
          You can still place an order — we&apos;ll prepare it at opening time.
        </div>
      </div>
    </div>
  );
}
