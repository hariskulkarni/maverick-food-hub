'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Reveal — adds a soft fade/slide-up animation the first time its children
 * scroll into view. Uses IntersectionObserver so it's CPU-cheap and respects
 * users who prefer reduced motion (no animation at all in that case).
 */
export function Reveal({ children, delayMs = 0 }: { children: React.ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setTimeout(() => setShown(true), delayMs);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -80px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delayMs]);

  return (
    <div
      ref={ref}
      className={shown ? 'reveal' : 'opacity-0 translate-y-5'}
      style={{ transition: 'opacity .5s, transform .5s' }}
    >
      {children}
    </div>
  );
}
