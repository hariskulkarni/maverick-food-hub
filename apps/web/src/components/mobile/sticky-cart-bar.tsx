'use client';
/**
 * Sticky cart bar — appears just above the bottom-nav on mobile when the cart
 * has items. EatClub/Zomato/Swiggy use the same pattern: a thin gradient strip
 * that summarises the cart and offers a one-tap path to checkout from any
 * customer surface.
 *
 *   <- 3 items · ₹540    [ View cart → ]
 *
 * Hidden on tablet/desktop (the top-nav already shows a cart link).
 * Hidden on /cart and /checkout (no point re-advertising what the customer is
 * already looking at).
 *
 * Composes with `<MobileBottomNav>`: the bottom: offset is `calc(56px + safe-area)`
 * so the bar floats above the nav with the same safe-area padding logic.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShoppingBag, ChevronRight } from 'lucide-react';
import { useCart } from '@/app/(customer)/cart-context';
import { useBottomNavVisible } from './bottom-nav';
import { money } from '@/lib/utils';

export function StickyCartBar() {
  const path = usePathname() ?? '/';
  const navVisible = useBottomNavVisible();
  const { lines, count, subtotal } = useCart();

  // Same visibility window as the bottom nav, minus pages where it'd be redundant.
  if (!navVisible) return null;
  if (path.startsWith('/cart') || path.startsWith('/checkout')) return null;
  if (count === 0) return null;

  return (
    <div
      className="md:hidden fixed inset-x-0 z-40"
      // 56px = bottom nav height. The safe-area-inset doubles up on iOS via
      // both the nav's padding AND ours, so we keep this number as a plain
      // value and rely on the nav's own env() to lift the whole stack.
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-md px-3 pb-2">
        <Link
          href="/cart"
          aria-label={`Open cart — ${count} item${count === 1 ? '' : 's'}, total ${money(subtotal)}`}
          className="reveal group flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground px-4 py-3 shadow-lg shadow-primary/25 tap-press"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="relative grid size-9 place-items-center rounded-full bg-white/15 shrink-0">
              <ShoppingBag className="size-4" />
              <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-primary text-[10px] font-bold leading-[18px] text-center shadow">
                {count > 9 ? '9+' : count}
              </span>
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[11px] uppercase tracking-wider opacity-90">
                {count} item{count === 1 ? '' : 's'} in cart
              </span>
              <span className="block font-semibold text-base truncate">
                {money(subtotal)}
                <span className="opacity-75 font-normal text-xs ml-2">view to checkout</span>
              </span>
            </span>
          </span>
          <span className="shrink-0 grid size-9 place-items-center rounded-full bg-white/15 group-hover:bg-white/20 transition-colors">
            <ChevronRight className="size-4" />
          </span>
        </Link>
      </div>
    </div>
  );
}
