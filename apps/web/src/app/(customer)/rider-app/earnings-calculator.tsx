'use client';

import { useState, useMemo } from 'react';
import { Wallet, TrendingUp, Award, Star } from 'lucide-react';

import { computeFromRule } from '@/lib/payout-math';
import { TIERS as TIER_LADDER } from '@/lib/rider-tiers';

/**
 * Interactive per-delivery earnings calculator. Riders pick a distance, a
 * surge level and a tier, and we run the pay engine's own maths
 * (`computeFromRule`, the function the dispatch engine calls at claim time)
 * with the platform DEFAULT rates — ₹30 base, ₹5/km after the first km, tier
 * bonus applied to the surge uplift only. The live rate can differ when the
 * platform team configures a payout rule, so the copy says "default rates".
 *
 * Evaluated at an off-peak IST time so peak/late-night bonuses don't inflate
 * the example. Tips are not shown: the platform does not collect tips yet.
 */
const OFF_PEAK_EXAMPLE = new Date('2026-01-07T10:30:00.000Z'); // Wed 16:00 IST

const TIERS = TIER_LADDER.map((t) => ({
  name: t.name.charAt(0) + t.name.slice(1).toLowerCase(),
  pct: Math.round(t.surgeShareBonus * 100),
  share: t.surgeShareBonus,
  hint: t.requirement,
}));

const SURGES = [
  { val: 1.0, label: 'No surge' },
  { val: 1.2, label: '1.2× soft' },
  { val: 1.5, label: '1.5× busy' },
  { val: 2.0, label: '2.0× peak' },
];

export function EarningsCalculator() {
  const [km, setKm] = useState(4);
  const [surge, setSurge] = useState(1.0);
  const [tierIdx, setTierIdx] = useState(0);

  const breakdown = useMemo(() => {
    const r = computeFromRule(null, {
      distanceKm: km,
      placedAt: OFF_PEAK_EXAMPLE,
      subtotal: 0,
      surgeMultiplier: surge,
      tierSurgeShareBonus: TIERS[tierIdx].share,
    });
    // Split the engine's surge bonus into the plain surge uplift and the tier's extra share.
    const surgeOnly = r.surgeMultiplier > 1 ? (r.surgeBonus / (1 + r.tierSurgeShareBonus)) : 0;
    return {
      base: r.baseAmount,
      distance: r.perKmAmount + r.longDistanceAmount,
      surgeAdd: +surgeOnly.toFixed(2),
      tierAdd: +(r.surgeBonus - surgeOnly).toFixed(2),
      total: r.payout,
    };
  }, [km, surge, tierIdx]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Sliders */}
      <div className="rounded-3xl border bg-card p-6 md:p-8 shadow-sm space-y-6">
        <SliderRow label="Distance" value={`${km} km`} hint="Restaurant → customer">
          <input type="range" min={1} max={12} step={0.5} value={km} onChange={(e) => setKm(Number(e.target.value))}
            className="w-full accent-primary" />
        </SliderRow>

        <div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-sm font-semibold">Surge in your area</div>
              <div className="text-xs text-muted-foreground">Higher during peak hours / heavy rain</div>
            </div>
            <div className="text-sm font-bold text-primary">{surge.toFixed(1)}×</div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SURGES.map((s) => (
              <button
                key={s.val}
                type="button"
                onClick={() => setSurge(s.val)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors ${
                  surge === s.val ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-sm font-semibold">Your tier</div>
              <div className="text-xs text-muted-foreground">{TIERS[tierIdx].hint}</div>
            </div>
            <div className="text-sm font-bold text-primary">+{TIERS[tierIdx].pct}% of surge</div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {TIERS.map((t, i) => {
              const Icon = i === 0 ? Award : i === 1 ? Award : i === 2 ? Star : Star;
              const colour = i === 0 ? 'text-warning' : i === 1 ? 'text-muted-foreground' : i === 2 ? 'text-warning' : 'text-primary';
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setTierIdx(i)}
                  className={`rounded-xl border px-2 py-3 text-center transition-colors ${
                    tierIdx === i ? 'border-primary bg-primary/10' : 'hover:border-primary/40'
                  }`}
                >
                  <Icon className={`size-4 mx-auto ${colour}`} />
                  <div className="text-xs font-semibold mt-1">{t.name}</div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* Result panel */}
      <div className="rounded-3xl bg-gradient-to-br from-primary via-primary to-berry text-primary-foreground p-6 md:p-8 shadow-xl shadow-primary/20 flex flex-col">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
          <Wallet className="size-3.5" /> Per delivery
        </div>
        <div key={breakdown.total.toFixed(2)} className="display text-5xl md:text-6xl font-extrabold mt-2 roll-up tabular-nums">
          ₹{breakdown.total.toFixed(0)}
        </div>
        <div className="text-xs opacity-80 mt-1">Platform default rates. Added to your earnings balance when you confirm delivery.</div>

        <div className="mt-5 space-y-1.5 text-sm border-t border-white/20 pt-4">
          <Row label="Base fare" value={breakdown.base} />
          <Row label={`Distance · ₹5/km after the first km`} value={breakdown.distance} />
          {breakdown.surgeAdd > 0 && <Row label={`Surge ${surge}×`} value={breakdown.surgeAdd} positive />}
          {breakdown.tierAdd > 0 && <Row label={`${TIERS[tierIdx].name} tier surge share`} value={breakdown.tierAdd} positive />}
        </div>

        <div className="mt-5 rounded-xl bg-white/10 backdrop-blur p-3 text-xs flex items-start gap-2">
          <TrendingUp className="size-4 shrink-0 mt-0.5" />
          <div>Doing 25 deliveries like this in a day = <strong>₹{(breakdown.total * 25).toFixed(0)}</strong></div>
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, value, hint, children }: { label: string; value: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <div className="text-sm font-bold text-primary tabular-nums">{value}</div>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-80">{label}</span>
      <span className={`tabular-nums font-semibold ${positive ? 'text-pop' : ''}`}>
        {positive ? '+' : ''}₹{value.toFixed(2)}
      </span>
    </div>
  );
}
