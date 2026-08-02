'use client';
import { BrandMark } from '@/components/brand-mark';
import { ShieldCheck, Activity, Lock, ArrowUpRight } from 'lucide-react';

/**
 * Left-hand panel for the STAFF PORTAL login (portal.flavrly.in) — the
 * operations-console counterpart to the customer <MarketingPanel>. Same slot
 * contract (a `compact` mobile variant + the full desktop column) but themed as
 * a professional ops surface: deep-berry brand backdrop, coral accent, and a
 * lime "live" status dot. On-brand, clearly distinct from the customer site.
 *
 * Style: "Soft UI Evolution" — subtle depth via soft glow blobs, not flat, not
 * neumorphic. Text is white/white-70 on deep berry (WCAG AA+).
 */
const SIGNALS = [
  { Icon: ShieldCheck, title: 'Secure staff access', body: 'Isolated from the customer app — separate login and session.' },
  { Icon: Activity, title: 'Real-time operations', body: 'Live orders, kitchen and rider dispatch in one console.' },
  { Icon: Lock, title: 'Role-scoped', body: 'Admin, kitchen and platform ops each see only what they should.' },
];

export function PortalMarketingPanel({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-berry p-6 text-white">
        <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-primary/30 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-2">
          <BrandMark className="text-xl text-white" />
          <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            Portal
          </span>
        </div>
        <p className="relative z-10 mt-3 max-w-xs text-sm text-white/70">
          Staff &amp; platform operations. Secure, role-scoped access.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-berry p-10 text-white">
      <div className="float-soft pointer-events-none absolute -top-24 -left-16 size-80 rounded-full bg-primary/30 blur-3xl" aria-hidden="true" />
      <div
        className="float-soft pointer-events-none absolute bottom-0 right-0 size-72 rounded-full bg-pop/20 blur-3xl"
        aria-hidden="true"
        style={{ animationDelay: '1.5s' }}
      />

      <div className="relative z-10 flex items-center gap-2.5">
        <BrandMark className="text-2xl text-white" />
        <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
          Portal
        </span>
      </div>

      <div className="relative z-10 mt-12 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Operations console
        </div>
        <h2 className="display mt-3 text-3xl font-semibold leading-tight md:text-4xl">
          Run every restaurant
          <br />
          from one place.
        </h2>

        <ul className="mt-10 space-y-5">
          {SIGNALS.map(({ Icon, title, body }) => (
            <li key={title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-primary ring-1 ring-white/10">
                <Icon className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-xs text-white/65">{body}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 mt-10 flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-2 text-white/70">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pop opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-pop" />
          </span>
          All systems operational
        </span>
        <a href="https://flavrly.in" className="inline-flex items-center gap-1 text-white/60 transition-colors hover:text-white">
          flavrly.in <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
