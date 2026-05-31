import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { MobileNavBar } from './mobile-nav-bar';

/**
 * Shared shell for admin + platform sidebar layouts. Mobile-first:
 *   • Phones (< md): a sticky top bar with a hamburger that opens a
 *     full-height slide-in drawer (rendered by MobileNavBar, a client
 *     component). The persistent sidebar is hidden.
 *   • md+: the classic grid-cols-[240px_1fr] layout — persistent
 *     sidebar on the left, content on the right.
 *
 * Both surfaces use this shell, so adding a new admin route is
 * "drop a nav entry in the appropriate config and add a page.tsx".
 *
 * AdminShell itself is a server component (no client APIs). The
 * mobile drawer + hamburger open-state live in MobileNavBar.
 */

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

export interface NavGroup {
  /** Optional uppercase section header. Omit for the default top group. */
  title?: string;
  items: NavItem[];
}

export interface AdminShellProps {
  /**
   * Branding shown at the top of the sidebar AND in the mobile top bar.
   * Pass a ReactNode so callers can drop in interactive widgets like a
   * RestaurantSwitcher.
   */
  title: React.ReactNode;
  /** Small line under the title (e.g. "Super admin", "Restaurant admin"). */
  subtitle?: React.ReactNode;
  /** Sidebar nav, in display order. Groups render with section headers. */
  navGroups: NavGroup[];
  /** Optional content at the bottom of the sidebar (user info + logout). */
  footer?: React.ReactNode;
  /**
   * Optional banner/strip that renders ABOVE the whole shell on every
   * breakpoint (e.g. the demo banner). Stays outside the sidebar so it
   * spans full width.
   */
  topBanner?: React.ReactNode;
  /**
   * Optional element that renders INSIDE main, at the top, on every
   * breakpoint (e.g. demo-mode "Reset demo" button on /platform).
   */
  contentTopSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({
  title,
  subtitle,
  navGroups,
  footer,
  topBanner,
  contentTopSlot,
  children,
}: AdminShellProps) {
  return (
    // Outer wrapper width-clamped to viewport so any deep child (long
    // restaurant name, big order code, JSON dump in a drawer) can't make
    // the page scroll right on phones. max-w-[100vw]+overflow-x-hidden
    // beats overflow-x-clip on older iOS Safari.
    <div className="flex min-h-dvh flex-col max-w-[100vw] overflow-x-hidden">
      {topBanner}

      {/* Mobile top bar — hamburger + title + subtitle. Hidden on md+. */}
      <MobileNavBar
        title={title}
        subtitle={subtitle}
        navGroups={navGroups}
        footer={footer}
      />

      <div className="flex-1 md:grid md:grid-cols-[240px_1fr]">
        {/* Desktop sidebar — hidden on phones. */}
        <aside className="hidden md:flex md:flex-col border-r bg-card">
          <div className="p-5 border-b">
            <div className="display text-lg font-bold text-primary">{title}</div>
            {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1 text-sm">
            {navGroups.map((g, i) => (
              <SidebarGroup key={i} group={g} />
            ))}
          </nav>
          {footer && <div className="p-3 border-t">{footer}</div>}
        </aside>

        {/* min-w-0 on the grid child: required so its content (long table
            rows etc.) doesn't push the grid wider than the viewport on
            phones. overflow-x-auto lets a wide table scroll internally
            without breaking the page. */}
        <main className="bg-background min-w-0 max-w-full overflow-x-auto">
          {contentTopSlot}
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarGroup({ group }: { group: NavGroup }) {
  return (
    <div className="space-y-1">
      {group.title && (
        <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.title}
        </div>
      )}
      {group.items.map((item) => (
        <SidebarLink key={item.href} item={item} />
      ))}
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent min-h-[44px]"
    >
      <Icon className="size-4 shrink-0" /> <span className="truncate">{item.label}</span>
    </Link>
  );
}
