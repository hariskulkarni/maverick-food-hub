'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * StatsCounter — number rolls up from 0 to `end` over ~1.6 s the first time
 * the component scrolls into view (IntersectionObserver, so off-screen counters
 * stay quiet until they're needed).
 */
export function StatsCounter({
  end, label, prefix = '', suffix = '', decimals = 0,
}: {
  end: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setVal(end); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const dur = 1600;
          const start = performance.now();
          const tick = (t: number) => {
            const p = Math.min(1, (t - start) / dur);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(end * eased);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
          break;
        }
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [end]);

  const display = decimals > 0
    ? val.toFixed(decimals)
    : Math.round(val).toLocaleString('en-IN');

  return (
    <div ref={ref}>
      <div className="display text-3xl md:text-5xl font-bold text-primary tabular-nums">
        {prefix}{display}{suffix}
      </div>
      <div className="mt-1 text-xs md:text-sm text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}
