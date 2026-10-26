'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle, Activity, Award, BadgeCheck, BarChart3, BookOpen, Building2, CalendarClock, ChevronDown,
  ClipboardCheck, Coins, CreditCard, FileSpreadsheet, Flame, Gauge, Gift, GraduationCap, Headphones, History,
  Landmark, Layers, LayoutDashboard, LayoutTemplate, LifeBuoy, ListOrdered, MessageSquare, MessagesSquare,
  QrCode, Radar, Radio, Receipt, Search, Shield, ShieldAlert, ShieldCheck, Siren, SlidersHorizontal, Smartphone,
  Star, FlaskConical, Timer, Trophy, UserPlus, Users, Wallet, Banknote, Bike, X, type LucideIcon,
} from 'lucide-react';
import { activeHref, filterNavByQuery, type PlatformNavGroup, type PlatformNavIcon } from './nav-config';

const ICONS: Record<PlatformNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, analytics: BarChart3, reports: FileSpreadsheet, live: Radio, liveOps: AlertTriangle,
  orders: ListOrdered, restaurants: Building2, brands: Layers, cms: LayoutTemplate, qr: QrCode,
  feedback: MessageSquare, reviews: Star,
  riders: Bike, kyc: BadgeCheck, shifts: CalendarClock, dispatch: Timer, surge: Flame, settings: SlidersHorizontal,
  training: GraduationCap, appReleases: Smartphone,
  payoutRules: Receipt, riderPayouts: Wallet, incentives: Trophy, tiers: Award, referrals: UserPlus,
  sos: Siren, incidents: ShieldAlert, riderSupport: Headphones, messages: MessagesSquare,
  settlements: Banknote, cod: Coins, gateways: Landmark, pg: CreditCard, pgAdmin: Gauge,
  users: Users, testAccounts: FlaskConical, support: LifeBuoy, help: BookOpen, bonus: Gift,
  iam: ShieldCheck, approvals: ClipboardCheck, security: Shield, auditLog: History, health: Activity,
  observability: Radar,
};

const STORAGE_KEY = 'flavrly.platformNav.open';

function readOpen(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function writeOpen(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / storage disabled: state just isn't remembered */
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Super-admin sidebar: operation groups (collapsible, remembered per browser),
 * a quick filter ("/" to focus, Esc to clear, Enter opens the first match) and
 * the current page highlighted. Groups arrive already capability-filtered by the
 * server layout, so this component never decides who may see what.
 */
export function PlatformNav({ groups }: { groups: PlatformNavGroup[] }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  const current = activeHref(groups, pathname);
  const currentGroup = groups.find((g) => g.items.some((it) => it.href === current))?.id ?? null;

  // SSR + first paint: only the current section open. After mount, restore the
  // sections this browser had open (localStorage) and keep the current one open.
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentGroup ? [currentGroup] : []));
  useEffect(() => {
    const saved = readOpen();
    if (saved) setOpen(new Set(currentGroup ? [...saved, currentGroup] : saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!currentGroup) return;
    setOpen((prev) => (prev.has(currentGroup) ? prev : new Set([...prev, currentGroup])));
  }, [currentGroup]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeOpen(next);
      return next;
    });

  // "/" focuses the filter (only the visible instance: desktop sidebar or open drawer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const filtering = query.trim().length > 0;
  const shown = useMemo(() => filterNavByQuery(groups, query), [groups, query]);
  const matchCount = shown.reduce((n, g) => n + g.items.length, 0);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        setQuery('');
      } else {
        inputRef.current?.blur();
      }
    } else if (e.key === 'Enter' && filtering) {
      const first = shown[0]?.items[0];
      if (first) {
        e.preventDefault();
        setQuery('');
        router.push(first.href);
      }
    }
  };

  return (
    <nav aria-label="Platform" className="space-y-2 text-sm">
      <div className="relative">
        <label htmlFor={`${uid}-q`} className="sr-only">
          Filter menu
        </label>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={`${uid}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Filter menu…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${uid}-hint`}
          className="h-11 w-full rounded-md border bg-background pl-9 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
        />
        {filtering ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear filter"
            className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        ) : (
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:block"
          >
            /
          </kbd>
        )}
        <span id={`${uid}-hint`} className="sr-only">
          Type to filter the menu. Press Enter to open the first match, Escape to clear.
        </span>
      </div>

      <p className="sr-only" aria-live="polite">
        {filtering ? `${matchCount} ${matchCount === 1 ? 'page' : 'pages'} match` : ''}
      </p>

      {filtering && matchCount === 0 && (
        <p className="px-3 py-6 text-center text-muted-foreground">
          No pages match “{query.trim()}”.
        </p>
      )}

      <div className="space-y-1">
        {shown.map((g) => {
          const expanded = filtering || open.has(g.id);
          const listId = `${uid}-${g.id}`;
          const hasActive = g.items.some((it) => it.href === current);
          return (
            <section key={g.id} aria-labelledby={`${listId}-t`}>
              {filtering ? (
                <h2 className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                  <span id={`${listId}-t`}>{g.title}</span>
                </h2>
              ) : (
                <h2 className="m-0">
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    aria-expanded={expanded}
                    aria-controls={listId}
                    className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span id={`${listId}-t`} className="flex-1 truncate">{g.title}</span>
                    {hasActive && !expanded && (
                      <span className="size-1.5 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">(current page inside)</span>
                      </span>
                    )}
                    <span aria-hidden className="rounded-full bg-muted px-1.5 text-[10px] font-medium">
                      {g.items.length}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`size-4 shrink-0 motion-safe:transition-transform ${expanded ? '' : '-rotate-90'}`}
                    />
                  </button>
                </h2>
              )}
              <ul id={listId} hidden={!expanded} className="space-y-0.5">
                {g.items.map((it) => {
                  const Icon = ICONS[it.icon];
                  const active = it.href === current;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-[44px] items-center gap-2 rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent'
                        }`}
                      >
                        <Icon aria-hidden className="size-4 shrink-0" />
                        <span className="truncate">{it.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
