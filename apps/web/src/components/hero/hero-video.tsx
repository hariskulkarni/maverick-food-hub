'use client';

import { useEffect, useState } from 'react';

/**
 * Connection-aware hero video.
 *
 * The food photo beneath (in HeroStage) is the always-present visual, so this
 * component only ADDS the motion loop when it's cheap to do so. It mounts the
 * <video> only after deciding the client can afford it:
 *   • skips entirely on Save-Data, or slow effective connections (2g/3g),
 *   • skips when the user prefers reduced motion,
 *   • renders nothing during SSR / first paint (so the poster + photo paint
 *     instantly and the ~260 KB clip never blocks initial load).
 * On capable connections it mounts with preload="metadata" + poster, so even
 * then only lightweight metadata is fetched until playback can begin.
 */
export function HeroVideo() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const slow = !!conn && (conn.saveData === true || ['slow-2g', '2g', '3g'].includes(conn.effectiveType ?? ''));
    if (!prefersReduced && !slow) setEnabled(true);
  }, []);

  if (!enabled) return null;

  return (
    <video
      className="absolute inset-0 size-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster="/hero-poster.jpg"
      aria-hidden
      tabIndex={-1}
    >
      <source src="/hero.mp4" type="video/mp4" />
    </video>
  );
}
