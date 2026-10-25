'use client';
/**
 * Rider portal home: online status (read-only), the active delivery, today /
 * week earnings and KYC gating — all from the same endpoints as the app.
 * Going online and running deliveries stay in the app (live GPS tracking).
 */
import Link from 'next/link';
import { Smartphone, MapPin, Wallet, Navigation, CircleDot, ShieldAlert, CalendarClock, LifeBuoy, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { riderApi, rupees, fmtDateTime } from '../_lib/api';
import type { Assignment, EarningsSummary, KycResponse, RiderMe } from '../_lib/types';
import { ErrorPanel, Panel, Stat, useLoad } from '../_components/bits';

const ACTIVE = new Set(['PENDING', 'ACCEPTED', 'PICKED_UP']);
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for you to accept',
  ACCEPTED: 'Heading to the restaurant',
  PICKED_UP: 'Food picked up — on the way to the customer',
};

function mapsLink(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function Dashboard({ firstName, children }: { firstName: string | null; children: React.ReactNode }) {
  const me = useLoad(() => riderApi<RiderMe>('/api/rider/me'));
  const jobs = useLoad(() => riderApi<Assignment[]>('/api/rider/assignments'));
  const earn = useLoad(() => riderApi<EarningsSummary>('/api/rider/earnings'));
  const kyc = useLoad(() => riderApi<KycResponse>('/api/rider/kyc'));

  const active = (jobs.data ?? []).filter((a) => ACTIVE.has(a.status));
  const gating = kyc.data?.gating;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="display text-2xl font-bold md:text-3xl">{firstName ? `Hi, ${firstName}` : 'Your rider portal'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Earnings, payouts, documents, shifts and training — on any screen.</p>
      </header>

      {gating?.enforced && !gating.canGoOnline && (
        <Link href="/rider/kyc" className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm hover:bg-warning/15">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <span className="flex-1">
            <span className="font-semibold">Documents needed before you can go online.</span>{' '}
            {gating.message ?? 'Upload the missing documents to start taking deliveries.'}
          </span>
          <ChevronRight className="mt-0.5 size-4 shrink-0" />
        </Link>
      )}

      {/* Online status — read-only on the web */}
      <Panel>
        {me.loading && !me.data ? (
          <Skeleton className="h-16 w-full" />
        ) : me.error ? (
          <ErrorPanel message={me.error} onRetry={me.reload} />
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className={cn('grid size-11 place-items-center rounded-full', me.data?.online ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
                <CircleDot className="size-5" />
              </span>
              <div>
                <div className="font-semibold">{me.data?.online ? 'You are online in the app' : 'You are offline'}</div>
                <div className="text-xs text-muted-foreground">
                  {me.data?.lastSeenAt ? `Last GPS ping ${fmtDateTime(me.data.lastSeenAt)}` : 'No recent GPS ping'}
                  {me.data?.riderType === 'DEDICATED' && me.data.dedicatedRestaurant ? ` · Dedicated to ${me.data.dedicatedRestaurant.name}` : ''}
                </div>
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground sm:ml-auto sm:max-w-sm">
              <Smartphone className="mt-0.5 size-4 shrink-0" />
              Going online and running deliveries only works in the Flavrly Rider app, because customers and our team need your live GPS
              location during a delivery.
            </p>
          </div>
        )}
      </Panel>

      {/* Active delivery */}
      <Panel title="Current delivery">
        {jobs.loading && !jobs.data ? (
          <Skeleton className="h-24 w-full" />
        ) : jobs.error ? (
          <ErrorPanel message={jobs.error} onRetry={jobs.reload} />
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No delivery in progress. Go online in the app to get orders.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((a) => {
              const toCustomer = a.status === 'PICKED_UP';
              const dest = toCustomer
                ? mapsLink(a.order.address?.latitude, a.order.address?.longitude)
                : mapsLink(a.order.branch?.latitude, a.order.branch?.longitude);
              return (
                <li key={a.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">Order #{a.order.code}</div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{STATUS_LABEL[a.status] ?? a.status}</span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Pickup</dt>
                      <dd>
                        {a.order.branch ? `${a.order.branch.restaurantName ?? a.order.branch.name} · ${a.order.branch.line1}, ${a.order.branch.city}` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Drop</dt>
                      <dd>
                        {a.order.address
                          ? [a.order.address.line1, a.order.address.line2, a.order.address.landmark, a.order.address.city].filter(Boolean).join(', ')
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    {dest && (
                      <a
                        href={dest}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 px-4 text-sm font-semibold hover:bg-muted"
                      >
                        <Navigation className="size-4" /> {toCustomer ? 'Directions to customer' : 'Directions to restaurant'}
                      </a>
                    )}
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Smartphone className="size-3.5 shrink-0" /> Open the Rider app to continue this delivery (pickup, OTP hand-over, proof photo).
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* Earnings */}
      {earn.error ? (
        <ErrorPanel message={earn.error} onRetry={earn.reload} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {earn.loading && !earn.data ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <Stat tone="primary" label="Today" value={rupees(earn.data?.today.earnings)} sub={`${earn.data?.today.deliveries ?? 0} deliveries`} />
              <Stat label="This week" value={rupees(earn.data?.week?.earnings ?? 0)} sub={`${earn.data?.week?.deliveries ?? 0} deliveries`} />
              <Stat label="Lifetime" value={rupees(earn.data?.lifetime.totalEarnings)} sub={`${earn.data?.lifetime.totalDeliveries ?? 0} deliveries`} />
              <Stat label="Rating" value={`${(earn.data?.lifetime.rating ?? 0).toFixed(1)} ★`} />
            </>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <QuickLink href="/rider/earnings" icon={Wallet} title="Earnings & payouts" body="See every run and request a withdrawal." />
        <QuickLink href="/rider/shifts" icon={CalendarClock} title="My shifts" body="Book and cancel work slots." />
        <QuickLink href="/rider/help" icon={LifeBuoy} title="Help center" body="Answers for riders, in English and Hindi." />
        <QuickLink href="/rider/kyc" icon={ShieldAlert} title="Documents" body="Upload KYC documents and track verification." />
      </div>

      {children}
    </div>
  );
}

function QuickLink({ href, icon: Icon, title, body }: { href: string; icon: typeof MapPin; title: string; body: string }) {
  return (
    <Link href={href} className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
