/**
 * /rv/<token>/stop — the STOP / unsubscribe link carried in every review ask.
 * GET only renders the choice (link scanners must not unsubscribe anyone); the
 * customer confirms with a button that POSTs to the opt-out API.
 */
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { isValidToken } from '@/server/reviews/acquisition';
import { StopClient } from './stop-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stop review requests', robots: { index: false, follow: false } };

export default async function StopPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) notFound();
  const r = await prisma.reviewRequest.findUnique({
    where: { token },
    select: { customerId: true, restaurant: { select: { name: true } } },
  });
  if (!r) notFound();
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-xl font-bold">Stop review requests</h1>
        {r.customerId ? (
          <StopClient token={token} restaurantName={r.restaurant.name} />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">This link isn&apos;t tied to any messages, so there is nothing to unsubscribe from.</p>
        )}
      </div>
    </main>
  );
}
