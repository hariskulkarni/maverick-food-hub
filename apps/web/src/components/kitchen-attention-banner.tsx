'use client';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Full-width amber banner that pops in over the kitchen board whenever there
 * are unacknowledged new orders. Pulses and glows to be visible across a
 * noisy kitchen — the looping chime is owned by the parent (we don't fire
 * any audio from here so we stay easy to test / story).
 */
export interface KitchenAttentionBannerProps {
  count: number;
  onAcknowledge: () => void;
}

export function KitchenAttentionBanner({ count, onAcknowledge }: KitchenAttentionBannerProps) {
  if (count <= 0) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        // Slide-down + glow + pulse — kept inline so we don't need a tailwind
        // keyframe registration (animate-pulse is built-in to tailwind, the
        // slide-down uses a one-shot custom keyframe via inline style).
        'sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-4',
        'border-y-2 border-amber-300 bg-amber-600 px-6 py-4 text-amber-50',
        'shadow-[0_0_40px_rgba(245,158,11,0.6)]',
        'animate-pulse'
      ].join(' ')}
      style={{ animation: 'pulse 1.2s ease-in-out infinite' }}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="size-6 shrink-0" />
        <div>
          <div className="text-lg font-bold tracking-wide uppercase">
            New order{count > 1 ? `s` : ''} — needs attention
          </div>
          <div className="text-sm opacity-90">
            {count} unacknowledged order{count > 1 ? 's' : ''} waiting on the line
          </div>
        </div>
      </div>
      <Button
        size="lg"
        variant="secondary"
        onClick={onAcknowledge}
        className="bg-amber-50 text-amber-900 hover:bg-amber-100 font-bold tracking-wider"
      >
        ACKNOWLEDGE
      </Button>
    </div>
  );
}
