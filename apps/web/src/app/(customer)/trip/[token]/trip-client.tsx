'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { TripShareView } from '@/server/trip-share';

// Leaflet touches `window` at import — client only.
const TripMap = dynamic(() => import('./trip-map'), {
  ssr: false,
  loading: () => <div className="h-64 w-full rounded-xl border bg-muted/40" />
});

const POLL_MS = 15_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export function TripClient({ token, initial }: { token: string; initial: TripShareView }) {
  const [view, setView] = useState<TripShareView>(initial);

  useEffect(() => {
    if (view.state !== 'active') return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/trip/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (r.ok || r.status === 404) setView(await r.json());
      } catch {
        // keep the last good view; next tick retries
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [token, view.state]);

  if (view.state !== 'active') {
    const msg =
      view.state === 'not_found'
        ? 'This trip link is not valid.'
        : view.state === 'ended'
          ? 'This trip has ended. Live location is no longer shared.'
          : 'This trip link has expired.';
    return (
      <div className="container max-w-md px-4 py-12">
        <h1 className="display mb-2 text-2xl font-semibold">Live trip</h1>
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">{msg}</CardContent>
        </Card>
      </div>
    );
  }

  const who = view.riderFirstName ?? 'The rider';
  return (
    <div className="container max-w-md space-y-4 px-4 py-8">
      <div>
        <h1 className="display text-2xl font-semibold">{who}&apos;s live trip</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {view.statusLabel}
          {view.restaurantName ? ` · ${view.restaurantName}` : ''}
        </p>
      </div>
      {view.rider ? (
        <>
          <TripMap rider={view.rider} restaurant={view.restaurant} />
          <Card>
            <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
              <span className="flex items-center gap-2">
                <MapPin className="size-4 text-primary" /> Location updated {timeAgo(view.rider.updatedAt)}
              </span>
              <a
                className="flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                href={`https://maps.google.com/?q=${view.rider.lat},${view.rider.lng}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation className="size-4" /> Open in Maps
              </a>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No location received from the rider yet. This page refreshes automatically.
          </CardContent>
        </Card>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        Shared by the rider for safety. The link stops working when the trip ends or at{' '}
        {new Date(view.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST.
      </p>
    </div>
  );
}
