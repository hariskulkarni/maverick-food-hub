'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Paintbrush, UtensilsCrossed, Plug, BarChart3 } from 'lucide-react';

/**
 * Tab bar for the Storefront CMS hub. Each tab is its own nested route under
 * /admin/storefront, so each loads only its own data (lazy by route). The
 * active tab is resolved from the current pathname.
 */
const TABS = [
  { href: '/admin/storefront', label: 'Design', icon: Paintbrush, exact: true },
  { href: '/admin/storefront/menu', label: 'Menu', icon: UtensilsCrossed, exact: false },
  { href: '/admin/storefront/integrations', label: 'Integrations', icon: Plug, exact: false },
  { href: '/admin/storefront/reports', label: 'Reports', icon: BarChart3, exact: false },
];

export function CmsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b -mx-1 px-1 no-scrollbar">
      {TABS.map(({ href, label, icon: Icon, exact }) => {
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
