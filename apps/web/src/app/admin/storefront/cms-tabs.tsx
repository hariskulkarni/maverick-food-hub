'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
    <nav className="flex gap-1 overflow-x-auto border-b -mx-1 px-1 no-scrollbar">
      {TABS.map(({ href, label, icon: Icon, ...rest }) => {
        const exact = 'exact' in rest && rest.exact;
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
