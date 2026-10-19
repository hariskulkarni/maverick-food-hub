'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Paintbrush, UtensilsCrossed, BadgePercent, Plug } from 'lucide-react';

/**
 * Top-level tab bar for the Storefront CMS hub. Scoped to the surfaces that
 * shape the public storefront and its merchandising — Design, Menu, Promotions
 * and Integrations. Day-to-day operations (orders, live tracking, reservations,
 * tables, branches), team and insights live on the admin sidebar instead, so the
 * two never duplicate each other. Each tab is its own nested route (Promotions
 * is a group with a sub-tab bar). Active tab resolved from the pathname.
 */
const TABS = [
  { href: '/admin/storefront', label: 'Design', icon: Paintbrush, exact: true },
  { href: '/admin/storefront/menu', label: 'Menu', icon: UtensilsCrossed },
  { href: '/admin/storefront/promotions', label: 'Promotions', icon: BadgePercent },
  { href: '/admin/storefront/integrations', label: 'Integrations', icon: Plug },
] as const;

export function CmsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Storefront sections"
      className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-2 no-scrollbar sm:mx-0 sm:px-0"
    >
      {TABS.map(({ href, label, icon: Icon, ...rest }) => {
        const exact = 'exact' in rest && rest.exact;
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
