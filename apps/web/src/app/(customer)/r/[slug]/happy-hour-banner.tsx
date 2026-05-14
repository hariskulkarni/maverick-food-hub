'use client';
/**
 * Happy-hour live banner. Server passes in the soonest window-end time
 * (HH:MM) and the count of currently-active rules; we render a saffron
 * gradient strip with a live countdown that ticks down in the browser.
 *
 * When the countdown hits zero we just freeze the label at "ends now" —
 * a fresh server render will replace the banner (or remove it) on the next
 * navigation. We intentionally avoid client-side polling because it would
 * be the only place in the customer flow that does so.
 */
import { useEffect, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';

export function HappyHourBanner({ endsAt, endsInMin, ruleCount }: { endsAt: string; endsInMin: number; ruleCount: number }) {
  // Tick the visible "x min left" pill down once a minute. We don't recompute
  // pricing — the server already locked in the right number when this page
  // loaded; this is purely cosmetic urgency.
  const [remaining, setRemaining] = useState<number>(endsInMin);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 60_000);
    return () => clearInterval(t);
  }, [remaining]);

  const label = remaining <= 0
    ? 'Happy Hour just ended'
    : remaining < 60
      ? `${remaining} min left`
      : `Ends at ${endsAt}`;

  return (
    <div className="border-b bg-gradient-to-r from-warning/15 via-primary/10 to-warning/15 backdrop-blur">
      <div className="container py-3 flex items-center gap-3 text-sm">
        <span className="grid size-8 place-items-center rounded-full bg-warning/20 text-warning shrink-0 pulse-soft">
          <Sparkles className="size-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-warning">
            Happy Hour is live · {ruleCount} {ruleCount === 1 ? 'deal' : 'deals'} on the menu
          </div>
          <div className="text-xs text-muted-foreground">Discounted prices are locked when you place your order.</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning text-warning-foreground px-3 py-1 text-xs font-semibold whitespace-nowrap">
          <Clock className="size-3.5" /> {label}
        </span>
      </div>
    </div>
  );
}
