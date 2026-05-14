'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { ArrowLeft } from 'lucide-react';

const VALUE_LINES = [
  'Order from every kitchen in town',
  'Track every order in real time',
  'Pay how you like — UPI, COD, wallet'
];

/**
 * Left-hand marketing panel for /login. Pure presentational — receives the
 * platform stats as props so /login/page.tsx can fetch them server-side and
 * keep this component a thin client wrapper (only needs `useState` for the
 * value-line rotator).
 *
 * On desktop this is a ~45% column that owns the gradient backdrop, the
 * brand wordmark, a rotating value-prop line, a 2x2 stat grid, and a small
 * footer. On mobile the same component compacts into a hero strip above the
 * form (no stat grid, no footer) — the parent decides which slot to drop it
 * into.
 */
export function MarketingPanel({
  restaurantsLive,
  cuisinesCount,
  compact = false
}: {
  restaurantsLive: number;
  cuisinesCount: number;
  /** When true, renders the mobile hero-strip variant (no rotator, no stats). */
  compact?: boolean;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (compact) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % VALUE_LINES.length), 4000);
    return () => clearInterval(t);
  }, [compact]);

  if (compact) {
    return (
      <div className="gradient-hero relative overflow-hidden rounded-2xl border border-border/60 p-6">
        <div
          className="float-soft pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-primary/20 blur-3xl"
          aria-hidden="true"
        />
        <Link href="/" className="inline-flex items-center gap-2">
          <BrandMark className="text-xl" />
        </Link>
        <p className="mt-3 text-sm text-muted-foreground max-w-xs">
          Order from every kitchen in town — faster reorders, live tracking,
          and pay any way you like.
        </p>
      </div>
    );
  }

  return (
    <div className="gradient-hero relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-3xl border border-border/60 p-10">
      <div
        className="float-soft pointer-events-none absolute -top-24 -left-16 size-80 rounded-full bg-primary/25 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="float-soft pointer-events-none absolute bottom-0 right-0 size-72 rounded-full bg-warning/20 blur-3xl"
        aria-hidden="true"
        style={{ animationDelay: '1.5s' }}
      />

      {/* Top: wordmark */}
      <Link
        href="/"
        className="relative z-10 inline-flex w-fit items-center gap-2 rounded-md"
        aria-label="Back to home"
      >
        <BrandMark className="text-2xl" />
      </Link>

      {/* Middle: rotating value line + stats */}
      <div className="relative z-10 mt-12 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary/80">
          Why sign in
        </div>
        <div
          className="display mt-3 min-h-[5.5rem] text-3xl font-semibold leading-tight md:text-4xl"
          aria-hidden="true"
        >
          {VALUE_LINES.map((line, i) => (
            <span
              key={line}
              className={[
                'block transition-opacity duration-700 ease-out',
                i === idx ? 'opacity-100' : 'pointer-events-none absolute opacity-0'
              ].join(' ')}
            >
              {line}
            </span>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4">
          <Stat label="Restaurants live" value={String(restaurantsLive)} />
          <Stat label="Cuisines" value={String(cuisinesCount)} />
          <Stat label="Avg delivery" value="~35 min" />
          <Stat label="Free signup" value="Always" />
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-10 flex items-center justify-between text-xs text-muted-foreground">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to home
        </Link>
        <div>Trusted by 2,000+ kitchens across India</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-4 backdrop-blur-sm">
      <div className="text-gradient-saffron display text-2xl font-semibold leading-none">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
