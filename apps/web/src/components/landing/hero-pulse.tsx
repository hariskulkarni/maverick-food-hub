'use client';

import * as React from 'react';
import { Counter } from '@/components/landing/counter';

/**
 * HeroPulse — the dynamic, "alive" stats element that replaces the old static
 * "{N} restaurants live · {N} riders · ~35 min" strip.
 *
 * It does three things, all motion-aware (honours prefers-reduced-motion):
 *   1. Count-up numbers for live restaurants + riders (reuses <Counter/>).
 *   2. A word-cycler that flips through craveable dishes — "biryani… pizza…
 *      rolls… thali — delivered hot" — so the line never sits still.
 *   3. A soft glowing "live" dot to sell the real-time feel.
 *
 * Layout is fixed-height per row so cycling text causes NO layout shift.
 */

const DISHES = ['biryani', 'pizza', 'rolls', 'thali', 'dosa', 'momos', 'burgers'] as const;

function WordCycler() {
  const [i, setI] = React.useState(0);
  const reduced = React.useRef(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduced.current) return;
    const id = window.setInterval(() => {
      setI((n) => (n + 1) % DISHES.length);
    }, 1900);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-baseline">
      {/* Reserve the width of the longest word so nothing shifts. */}
      <span className="relative inline-grid text-left align-baseline">
        <span aria-hidden className="invisible font-semibold">biryani</span>
        {DISHES.map((d, idx) => (
          <span
            key={d}
            aria-hidden={idx !== i}
            className={
              'col-start-1 row-start-1 font-semibold text-gradient-brand transition-all duration-500 ease-out ' +
              (idx === i
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 -translate-y-1 pointer-events-none')
            }
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function HeroPulse({
  restaurants,
  riders
}: {
  restaurants: number;
  riders: number;
}) {
  return (
    <div className="mt-12 flex justify-center reveal" aria-label="Live on Flavrly right now">
      <div className="hero-pulse-card group inline-flex max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-full border bg-card/70 px-5 py-3 backdrop-blur-md sm:gap-x-7">
        {/* Live word-cycler */}
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative inline-flex size-2.5">
            <span className="absolute inset-0 rounded-full bg-success pulse-soft" />
            <span className="size-2.5 rounded-full bg-success" />
          </span>
          <span className="hidden sm:inline">Right now:</span>
          <WordCycler />
          <span className="text-foreground/80">delivered hot</span>
        </span>

        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />

        {/* Count-up: live restaurants */}
        <span className="inline-flex items-baseline gap-1.5 text-sm text-muted-foreground">
          <Counter
            target={restaurants}
            className="font-tabular-nums text-base font-semibold text-foreground"
          />
          {restaurants === 1 ? 'kitchen live' : 'kitchens live'}
        </span>

        <span aria-hidden className="h-5 w-px bg-border" />

        {/* Count-up: riders */}
        <span className="inline-flex items-baseline gap-1.5 text-sm text-muted-foreground">
          <Counter
            target={riders}
            className="font-tabular-nums text-base font-semibold text-foreground"
          />
          riders nearby
        </span>

        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />

        {/* Static-but-shimmering ETA */}
        <span className="hidden items-baseline gap-1.5 text-sm text-muted-foreground sm:inline-flex">
          <span className="font-tabular-nums text-base font-semibold text-foreground">~35</span>
          min avg
        </span>
      </div>
    </div>
  );
}
