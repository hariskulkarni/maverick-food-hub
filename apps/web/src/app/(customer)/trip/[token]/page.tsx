import type { Metadata } from 'next';
import { loadTripShareView } from '@/server/trip-share';
import { TripClient } from './trip-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live trip',
  // Token-scoped page: never index share links.
  robots: { index: false, follow: false }
};

export default async function TripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadTripShareView(token);
  return <TripClient token={token} initial={view} />;
}
