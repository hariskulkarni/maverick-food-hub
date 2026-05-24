'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartyPopper, Sparkles, X } from 'lucide-react';
import { money } from '@/lib/utils';

/**
 * CartSavingsCelebration — a delightful popup that celebrates how much the
 * customer is saving on this cart (signup bonus + auto-applied offers + coupon).
 *
 * Behaviour:
 *   • Auto-fires the confetti + splash popup the first time savings appear and
 *     again whenever the total grows (e.g. a coupon is applied) — never nags on
 *     decreases, and resets when the cart's savings drop to zero.
 *   • A persistent "You're saving ₹X" chip stays in the cart and replays the
 *     celebration on tap.
 *   • Fully responsive (card is 90vw on mobile, fixed max-width on desktop) and
 *     honours prefers-reduced-motion (confetti/splash disabled via globals.css).
 *
 * Confetti reuses the global `.confetti-piece` keyframes; the card uses the
 * `.savings-card` pop and a `.savings-splash` radial ring.
 */

const CONFETTI_COLORS = ['#f23e5c', '#c026d3', '#c7f250', '#ffb020', '#22c55e', '#3b82f6', '#ff6b8b'];
const PIECE_COUNT = 48;
const AUTO_DISMISS_MS = 4200;

type Piece = { left: number; dx: number; delay: number; duration: number; color: string; w: number; h: number; round: boolean };

function makePieces(seed: number): Piece[] {
  // Deterministic-ish per burst so React keys are stable for one open cycle.
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: PIECE_COUNT }, () => ({
    left: rand() * 100,
    dx: (rand() - 0.5) * 240,
    delay: rand() * 0.5,
    duration: 1.8 + rand() * 1.4,
    color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
    w: 6 + Math.round(rand() * 6),
    h: 10 + Math.round(rand() * 8),
    round: rand() > 0.6
  }));
}

export function CartSavingsCelebration({ savings }: { savings: number }) {
  const [open, setOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const shownMax = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    setBurst((b) => b + 1);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
  }, []);

  // Auto-celebrate when savings first appear or grow past the last celebrated max.
  useEffect(() => {
    if (savings <= 0) {
      shownMax.current = 0;
      return;
    }
    if (savings > shownMax.current + 0.5) {
      shownMax.current = savings;
      trigger();
    }
  }, [savings, trigger]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pieces = useMemo(() => makePieces(burst || 1), [burst]);

  if (savings <= 0) return null;

  return (
    <>
      {/* Persistent, replayable savings chip */}
      <button
        type="button"
        onClick={trigger}
        aria-label={`You're saving ${money(savings)} on this order. Tap to celebrate.`}
        className="group mb-4 inline-flex w-full items-center gap-2.5 rounded-2xl border border-success/30 bg-gradient-to-r from-success/10 via-pop/10 to-success/10 px-4 py-3 text-left tap-press"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/20 text-success">
          <PartyPopper className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">
            You&apos;re saving <span className="text-success font-tabular-nums">{money(savings)}</span> on this order!
          </span>
          <span className="block text-[11px] text-muted-foreground">Tap to celebrate · applied automatically</span>
        </span>
        <Sparkles className="size-4 shrink-0 text-pop transition-transform group-hover:scale-110" />
      </button>

      {open && (
        <div
          className="savings-overlay fixed inset-0 z-[60] flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Savings celebration"
          onClick={() => setOpen(false)}
        >
          {/* Confetti layer — full screen, non-interactive */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {pieces.map((p, i) => (
              <span
                key={`${burst}-${i}`}
                className="confetti-piece"
                style={{
                  left: `${p.left}%`,
                  top: '-5%',
                  width: p.w,
                  height: p.h,
                  background: p.color,
                  borderRadius: p.round ? '9999px' : '2px',
                  // @ts-expect-error CSS custom property consumed by the keyframe
                  '--dx': `${p.dx}px`,
                  animationDelay: `${p.delay}s`,
                  animationDuration: `${p.duration}s`
                }}
              />
            ))}
          </div>

          {/* Card */}
          <div
            className="savings-card relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/40 bg-card p-7 text-center shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted-foreground tap-press hover:bg-accent"
            >
              <X className="size-4" />
            </button>

            {/* Radial splash behind the icon */}
            <div className="relative mx-auto mb-4 grid size-20 place-items-center">
              <span className="savings-splash absolute inset-0 rounded-full bg-success/30" aria-hidden />
              <span className="savings-splash absolute inset-0 rounded-full bg-pop/30" style={{ animationDelay: '0.12s' }} aria-hidden />
              <span className="relative grid size-16 place-items-center rounded-full bg-gradient-to-br from-success to-success/80 text-white shadow-lg">
                <PartyPopper className="size-8" />
              </span>
            </div>

            <div className="text-sm font-semibold uppercase tracking-wider text-success">You&apos;re saving</div>
            <div className="display mt-1 text-5xl font-extrabold text-foreground font-tabular-nums">{money(savings)}</div>
            <p className="mx-auto mt-2 max-w-[16rem] text-sm text-muted-foreground">
              on this order — discounts applied automatically at checkout. 🎉
            </p>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-gradient-to-r from-primary to-primary/90 px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 tap-press"
            >
              Sweet, let&apos;s go!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
