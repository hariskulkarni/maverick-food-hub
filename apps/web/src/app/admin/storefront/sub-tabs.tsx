'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Second-level sub-tab bar used inside CMS hub groups (Promotions, Operations,
 * Team, Insights). Active item resolved from the current pathname. Each item is
 * a nested route that mounts the corresponding (already-functional) admin module.
 */
export function SubTabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1.5 overflow-x-auto no-scrollbar px-6 pt-4 pb-1">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
