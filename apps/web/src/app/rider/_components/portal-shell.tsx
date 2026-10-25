'use client';
/**
 * Rider portal chrome: top bar (brand, rider, sign out), a desktop sidebar and
 * a phone bottom tab bar. Also keeps the cookie session alive: when the token
 * has < 3 days left it is slid forward once per page load via the existing
 * refresh endpoint (wrapped by /api/rider/web/session/refresh).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Wallet, FileCheck2, CalendarClock, GraduationCap, LifeBuoy, UserRound, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';
import { SESSION_ENDED_URL } from '../_lib/api';

const NAV = [
  { href: '/rider', label: 'Home', icon: Home },
  { href: '/rider/earnings', label: 'Earnings', icon: Wallet },
  { href: '/rider/kyc', label: 'Documents', icon: FileCheck2 },
  { href: '/rider/shifts', label: 'Shifts', icon: CalendarClock },
  { href: '/rider/training', label: 'Training', icon: GraduationCap },
  { href: '/rider/help', label: 'Help', icon: LifeBuoy },
  { href: '/rider/profile', label: 'Profile', icon: UserRound },
] as const;

/** Bottom tabs on phones: the five most-used; Help + Shifts stay reachable from Home/Profile. */
const MOBILE_TABS = ['/rider', '/rider/earnings', '/rider/kyc', '/rider/training', '/rider/profile'];

const REFRESH_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

function isActive(path: string, href: string) {
  return href === '/rider' ? path === '/rider' : path === href || path.startsWith(href + '/');
}

export async function signOut() {
  try {
    await fetch('/api/rider/web/session/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* the cookie is cleared server-side; fall through to the login page */
  }
  window.location.assign('/rider/login?signedOut=1');
}

export function PortalShell({
  riderName,
  avatarUrl,
  expiresAt,
  children,
}: {
  riderName: string;
  avatarUrl: string | null;
  expiresAt: string;
  children: React.ReactNode;
}) {
  const path = usePathname() ?? '/rider';
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const left = new Date(expiresAt).getTime() - Date.now();
    if (!(left < REFRESH_WITHIN_MS)) return;
    fetch('/api/rider/web/session/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((r) => {
        if (r.status === 401) window.location.assign(SESSION_ENDED_URL);
      })
      .catch(() => {
        /* offline — the next load retries */
      });
  }, [expiresAt]);

  async function onSignOut() {
    setSigningOut(true);
    toast.message('Signing you out…');
    await signOut();
  }

  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/rider" className="flex min-h-11 items-center gap-2" aria-label="Rider portal home">
            <BrandMark className="text-lg" />
            <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary sm:inline">Rider</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Link href="/rider/profile" className="flex min-h-11 min-w-0 items-center gap-2 rounded-full px-1 hover:bg-muted">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {riderName.trim().charAt(0).toUpperCase() || 'R'}
                </span>
              )}
              <span className="hidden max-w-[12rem] truncate text-sm font-medium sm:inline">{riderName}</span>
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 pb-28 pt-4 md:pb-10 md:pt-6">
        <nav aria-label="Rider portal" className="sticky top-20 hidden h-fit w-52 shrink-0 md:block">
          <ul className="space-y-1">
            {NAV.map((n) => {
              const active = isActive(path, n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                      active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <n.icon className="size-4 shrink-0" /> {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <nav aria-label="Rider portal" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => MOBILE_TABS.includes(n.href)).map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <n.icon className="size-5" /> {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
