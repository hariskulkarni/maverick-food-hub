'use client';
/**
 * Mobile bottom navigation — fixed below-viewport tab bar on phones.
 *
 * Two variants depending on route context:
 *
 *  ◾ DEFAULT (global, customer-facing):
 *     Home / Dine In / Cart / Orders / Profile  (5 tabs)
 *     The standard nav for the discovery surface + cart + orders + profile.
 *
 *  ◾ RESTAURANT ORDERING (when path is /r/<slug> or any /r/<slug>/...):
 *     Dine-In / Orders / Cart / Profile  (4 tabs)
 *     The Home + Dine In tabs are replaced by a single Dine-In tab that opens
 *     a chooser sheet ("Reserve a table" / "Scan the table QR") instead of
 *     navigating. This matches the in-restaurant customer flow where the
 *     customer has already committed to one restaurant — the flavrly URL was
 *     reached from the restaurant's own external homepage, so the customer is
 *     already in "ordering mode" the moment the page loads.
 *
 * Design language:
 *   - Sticks to the bottom on screens < md (768px). Hidden on tablet/desktop.
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
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingBag, Receipt, UserRound, UtensilsCrossed } from 'lucide-react';
import { useCart } from '@/app/(customer)/cart-context';
import { DineInChooser } from '@/components/storefront/dine-in-chooser';

type NavAction = { kind: 'link'; href: string } | { kind: 'dine-in' };

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Active when pathname starts with one of these prefixes. */
  activeOn: string[];
  /** Render in a "promoted" style when the cart has items. Used for the cart tab. */
  promotable?: boolean;
  action: NavAction;
}

const DEFAULT_ITEMS: NavItem[] = [
  { label: 'Home',    icon: Home,        activeOn: ['/'],                                action: { kind: 'link', href: '/' } },
  { label: 'Dine In', icon: UtensilsCrossed, activeOn: ['/dine-in'],                       action: { kind: 'link', href: '/dine-in' } },
  { label: 'Cart',    icon: ShoppingBag, activeOn: ['/cart'],                            action: { kind: 'link', href: '/cart' }, promotable: true },
  { label: 'Orders',  icon: Receipt,     activeOn: ['/orders', '/track'],                action: { kind: 'link', href: '/orders' } },
  { label: 'Profile', icon: UserRound,   activeOn: ['/profile'],                         action: { kind: 'link', href: '/profile' } },
];

/** 4-tab variant for inside-restaurant ordering pages. Order matches the
 *  customer ask: Dine-In / Orders / Cart / Profile. */
function restaurantItems(slug: string): NavItem[] {
  return [
    { label: 'Dine-In', icon: UtensilsCrossed, activeOn: [`/r/${slug}/reserve`], action: { kind: 'dine-in' } },
    { label: 'Orders',  icon: Receipt,         activeOn: ['/orders', '/track'],  action: { kind: 'link', href: '/orders' } },
    { label: 'Cart',    icon: ShoppingBag,     activeOn: ['/cart'],              action: { kind: 'link', href: '/cart' }, promotable: true },
    { label: 'Profile', icon: UserRound,       activeOn: ['/profile'],           action: { kind: 'link', href: '/profile' } },
  ];
}

/**
 * Match /r/<slug> and any sub-path under it (reserve, me, login, staff, …).
 * Returns the slug, or null when the path is somewhere else entirely.
 *
 * NOTE: there is intentionally no separate "marketing homepage" route on the
 * Flavrly side — the URL/QR drops the customer straight onto the ordering
 * page, so we want the Dine-In nav active across the whole /r/<slug>/* tree.
 */
function matchRestaurantOrdering(path: string): string | null {
  const m = path.match(/^\/r\/([^/]+)(?:$|\/)/);
  return m ? m[1] : null;
}

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
  const [dineInOpen, setDineInOpen] = useState(false);

  const menuSlug = matchRestaurantOrdering(path);
  const items = menuSlug ? restaurantItems(menuSlug) : DEFAULT_ITEMS;
  const tabCount = items.length;

  if (!visible) return null;

  const activeIndex = items.findIndex((i) =>
    i.activeOn.some((p) => (p === '/' ? path === '/' : path.startsWith(p)))
  );
  // Tabs share the row equally, so the pill is 1/N wide and translates by
  // index * 100% (of that 1/N slot).
  const pillStyle = activeIndex >= 0
    ? { transform: `translateX(${activeIndex * 100}%)`, opacity: 1 }
    : { opacity: 0 };
  const tabWidthClass = tabCount === 4 ? 'w-1/4' : 'w-1/5';
  const gridColsClass = tabCount === 4 ? 'grid-cols-4' : 'grid-cols-5';

  return (
    <>
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
            className={`pointer-events-none absolute left-0 top-1.5 h-[calc(100%-12px)] ${tabWidthClass} px-2 transition-transform duration-300 ease-out`}
            style={pillStyle}
          >
            <div className="h-full w-full rounded-2xl bg-primary/10 ring-1 ring-primary/20" />
          </div>

          <ul className={`relative grid ${gridColsClass}`}>
            {items.map((item, idx) => {
              const Icon = item.icon;
              const isActive = activeIndex === idx;
              const showBadge = item.promotable && count > 0;
              const labelAria = `${item.label}${showBadge ? `, ${count} item${count === 1 ? '' : 's'} in cart` : ''}`;
              const className =
                'group relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 tap-press text-[11px] font-medium transition-colors ' +
                (isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground');
              const iconClass = 'transition-all ' + (isActive ? 'size-[22px] -translate-y-0.5' : 'size-5');
              const content = (
                <>
                  <span className="relative">
                    <Icon className={iconClass} />
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
                </>
              );
              return (
                <li key={item.label} className="contents">
                  {item.action.kind === 'link' ? (
                    <Link
                      href={item.action.href}
                      prefetch={false}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={labelAria}
                      className={className}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDineInOpen(true)}
                      aria-haspopup="dialog"
                      aria-expanded={dineInOpen}
                      aria-label={labelAria}
                      className={className}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* The chooser is only ever instantiated when we're on a restaurant
          ordering page (menuSlug truthy). We keep it mounted regardless of
          dineInOpen so its open/close animation runs from the bottom-nav
          button's transform origin. */}
      {menuSlug && (
        <DineInChooser open={dineInOpen} onOpenChange={setDineInOpen} slug={menuSlug} />
      )}
    </>
  );
}
