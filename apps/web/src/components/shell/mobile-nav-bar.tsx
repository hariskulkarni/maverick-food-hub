'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import type { NavGroup } from './admin-shell';

/**
 * Mobile top bar + slide-in drawer for the admin/platform shell.
 *
 *   • Renders only on phones (< md). On md+ the parent shell shows its
 *     persistent sidebar instead, and this component shows nothing.
 *   • Hamburger toggles a full-height left drawer with the same nav tree
 *     as the desktop sidebar. ESC, scrim tap, and tapping a link all
 *     close the drawer.
 *   • Body scroll-lock while open so the page behind doesn't jiggle.
 *   • Closes automatically on route change so navigation feels native.
 *   • Touch targets are min 44px tall so the hamburger is comfortable.
 */
export function MobileNavBar({
  title,
  subtitle,
  navGroups,
  footer,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  navGroups: NavGroup[];
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change. Without this the drawer stays open between
  // navigations, which feels broken on phones.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while open so the underlying page doesn't move.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent active:scale-95 transition-transform"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{title}</div>
            {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
          </div>
        </div>
      </header>

      {/* Scrim + drawer. Both render only when open so they stay out of
          the layout tree (and out of the SSR HTML when closed). The
          scrim fades in and the drawer slides in from the left. */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/45 animate-fade-in"
          />
          <aside
            role="dialog"
            aria-label="Navigation"
            className="absolute left-0 top-0 bottom-0 w-[84vw] max-w-[320px] bg-card border-r flex flex-col shadow-2xl animate-slide-in-l"
          >
            <div className="flex items-start justify-between gap-2 p-4 border-b">
              <div className="min-w-0">
                <div className="display text-lg font-bold text-primary truncate">{title}</div>
                {subtitle && <div className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</div>}
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent shrink-0"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1 text-sm">
              {navGroups.map((g, i) => (
                <DrawerGroup key={i} group={g} onNavigate={() => setOpen(false)} />
              ))}
            </nav>
            {footer && <div className="p-3 border-t">{footer}</div>}
          </aside>
        </div>
      )}
    </>
  );
}

function DrawerGroup({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  return (
    <div className="space-y-1">
      {group.title && (
        <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.title}
        </div>
      )}
      {group.items.map((item) => <DrawerLink key={item.href} item={item} onNavigate={onNavigate} />)}
    </div>
  );
}

function DrawerLink({ item, onNavigate }: { item: { href: string; icon: ReactNode; label: string }; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-3 py-3 min-h-[44px] hover:bg-accent active:bg-accent"
    >
      {item.icon} <span className="truncate">{item.label}</span>
    </Link>
  );
}
