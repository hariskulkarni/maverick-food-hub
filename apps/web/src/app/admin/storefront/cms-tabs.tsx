'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Paintbrush, UtensilsCrossed, BadgePercent, ClipboardList, Users, BarChart3, Plug } from 'lucide-react';

/**
 * Top-level tab bar for the Storefront CMS hub. Each tab is its own nested
 * route under /admin/storefront (some are groups with a second-level sub-tab
 * bar), so each loads only its own data. The active tab is resolved from the
 * current pathname.
 */
const TABS = [
  { href: '/admin/storefront', label: 'Design', icon: Paintbrush, exact: true },
  { href: '/admin/storefront/menu', label: 'Menu', icon: UtensilsCrossed },
  { href: '/admin/storefront/promotions', label: 'Promotions', icon: BadgePercent },
  { href: '/admin/storefront/operations', label: 'Operations', icon: ClipboardList },
  { href: '/admin/storefront/team', label: 'Team', icon: Users },
  { href: '/admin/storefront/insights', label: 'Insights', icon: BarChart3 },
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
