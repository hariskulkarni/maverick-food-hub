'use client';
/**
 * Mobile bottom navigation — fixed below-viewport tab bar on phones.
 *
 * Design language:
 *   - Sticks to the bottom on screens < md (768px). Hidden on tablet/desktop.
 *   - 5 destinations: Home / Explore / Cart (badge) / Orders / Profile
 *   - Pill-shaped active indicator that morphs between tabs (smooth transform)
 *   - Cart tab grows visually when items are present + shows count chip
 *   - Saffron accent for active state on a glassy white background
 *   - Honours `env(safe-area-inset-bottom)` so iOS home indicator + Capacitor
 *     gesture nav don't eat the buttons
 *   - 44×44 minimum tap target on every entry
 *
 * Visibility rules:
 *   - Hidden on non-customer surfaces (admin, kitchen, rider, platform, login,
 *     marketing onboarding wizards). The `useShouldRender` hook below
 *     centralises this so the layout doesn't need to know each route.
 *   - Hidden when the user is in an active checkout (`/checkout/*`) so the
 *     payment flow stays focused.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, ShoppingBag, Receipt, UserRound } from 'lucide-react';
import { useCart } from '@/app/(customer)/cart-context';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Active when pathname starts with one of these prefixes. The first href is the canonical. */
  activeOn: string[];
  /** Render in a "promoted" style when the cart has items. Used for the cart tab. */
  promotable?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/',            label: 'Home',    icon: Home,         activeOn: ['/'] },
  { href: '/restaurants', label: 'Explore', icon: Search,       activeOn: ['/restaurants', '/r/', '/brand/'] },
  { href: '/cart',        label: 'Cart',    icon: ShoppingBag,  activeOn: ['/cart'], promotable: true },
  { href: '/orders',      label: 'Orders',  icon: Receipt,      activeOn: ['/orders', '/track'] },
  { href: '/profile',     label: 'Profile', icon: UserRound,    activeOn: ['/profile'] },
];

/**
 * Returns true when the current pathname is a customer surface that should
 * display the bottom nav. Centralised so other components (e.g. the sticky
 * cart bar) can match exactly.
 */
export function useBottomNavVisible(): boolean {
  const path = usePathname() ?? '/';
  if (path.startsWith('/admin')) return false;
  if (path.startsWith('/platform')) return false;
  if (path.startsWith('/kitchen')) return false;
  if (path.startsWith('/rider')) return false;
  if (path.startsWith('/login') || path.startsWith('/signup')) return false;
  if (path.startsWith('/checkout')) return false;
  return true;
}

export function MobileBottomNav() {
  const path = usePathname() ?? '/';
  const visible = useBottomNavVisible();
  const { count } = useCart();
  if (!visible) return null;

  const activeIndex = ITEMS.findIndex((i) =>
    i.activeOn.some((p) => (p === '/' ? path === '/' : path.startsWith(p)))
  );
  // 5 tabs, equal width — translate the pill by activeIndex * 20% (each tab is 20% of the row).
  const pillStyle = activeIndex >= 0
    ? { transform: `translateX(${activeIndex * 100}%)`, opacity: 1 }
    : { opacity: 0 };

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="relative mx-auto max-w-md">
        {/* Sliding pill highlight — purely decorative, sits behind the icons. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-1.5 h-[calc(100%-12px)] w-1/5 px-2 transition-transform duration-300 ease-out"
          style={pillStyle}
        >
          <div className="h-full w-full rounded-2xl bg-primary/10 ring-1 ring-primary/20" />
        </div>

        <ul className="relative grid grid-cols-5">
          {ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const isActive = activeIndex === idx;
            const showBadge = item.promotable && count > 0;
            return (
              <li key={item.href} className="contents">
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`${item.label}${showBadge ? `, ${count} item${count === 1 ? '' : 's'} in cart` : ''}`}
                  className={
                    'group relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 tap-press text-[11px] font-medium transition-colors ' +
                    (isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  <span className="relative">
                    <Icon
                      className={
                        'transition-all ' +
                        (isActive
                          ? 'size-[22px] -translate-y-0.5'
                          : 'size-5')
                      }
                    />
                    {showBadge && (
                      <span
                        aria-hidden
                        className="absolute -right-2 -top-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-[18px] text-center shadow-sm ring-2 ring-background"
                      >
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </span>
                  <span className={isActive ? 'font-semibold tracking-tight' : 'tracking-tight'}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
