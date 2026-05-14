'use client';

/**
 * Reusable favorite toggle. One of `restaurantId` or `menuItemId` must be supplied.
 * Optimistically flips local state on click, fires the corresponding favorites API,
 * and reverts (with a toast) if the request fails.
 *
 * If `requireAuth` is true and `initial` is `false`, an un-signed-in click is treated as
 * an auth gate and routes to /login with a `next` param back to the current page.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface HeartButtonProps {
  restaurantId?: string;
  menuItemId?: string;
  initial: boolean;
  /** When true, an un-signed-in user is redirected to /login instead of toggling. */
  requireAuth?: boolean;
  /** Visual tone: 'default' for light backgrounds, 'glass' for image overlays. */
  variant?: 'default' | 'glass';
  size?: 'sm' | 'md';
  className?: string;
  /** Optional callback after a successful toggle (used by the favorites page to remove cards). */
  onChange?: (next: boolean) => void;
  /** Optional aria-label override. */
  label?: string;
}

export function HeartButton({
  restaurantId,
  menuItemId,
  initial,
  requireAuth = false,
  variant = 'default',
  size = 'md',
  className,
  onChange,
  label
}: HeartButtonProps) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initial);
  const [pending, startTransition] = useTransition();

  if (!restaurantId && !menuItemId) {
    // Defensive: render nothing rather than crash if mis-wired.
    return null;
  }

  const endpoint = restaurantId ? '/api/customer/favorites/restaurants' : '/api/customer/favorites/items';
  const idKey = restaurantId ? 'restaurantId' : 'menuItemId';
  const idVal = (restaurantId ?? menuItemId) as string;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (requireAuth && !favorited) {
      // Auth gate: send to login with a return path. We can't know the current URL on the server,
      // so use window.location here — the button is always client-rendered.
      const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    const nextValue = !favorited;
    setFavorited(nextValue);
    onChange?.(nextValue);

    startTransition(async () => {
      try {
        const res = nextValue
          ? await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [idKey]: idVal })
            })
          : await fetch(`${endpoint}?${idKey}=${encodeURIComponent(idVal)}`, { method: 'DELETE' });

        if (!res.ok) throw new Error(String(res.status));
      } catch {
        // Revert
        setFavorited(!nextValue);
        onChange?.(!nextValue);
        toast.error(nextValue ? 'Could not save favorite' : 'Could not remove favorite');
      }
    });
  }

  const sizeCls = size === 'sm' ? 'size-7' : 'size-9';
  const iconCls = size === 'sm' ? 'size-3.5' : 'size-4';

  const baseCls =
    variant === 'glass'
      ? 'bg-white/30 backdrop-blur-md border border-white/40 text-white hover:bg-white/45 shadow-md'
      : 'bg-card border border-border text-muted-foreground hover:text-primary hover:border-primary/40 shadow-sm';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={label ?? (favorited ? 'Remove from favorites' : 'Add to favorites')}
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors tap-press disabled:opacity-70',
        sizeCls,
        baseCls,
        className
      )}
    >
      <Heart
        className={cn(
          iconCls,
          'transition-transform',
          favorited ? 'fill-primary text-primary scale-110' : '',
          variant === 'glass' && favorited ? 'fill-primary text-primary' : ''
        )}
      />
    </button>
  );
}
