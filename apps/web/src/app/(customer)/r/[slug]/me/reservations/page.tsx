/**
 * /r/[slug]/me/reservations — the customer's table reservations at one
 * restaurant. A standalone sub-page (rather than editing the `me` index) so it
 * stays additive and low-risk. Mirrors the tenancy gate + server-render pattern
 * of the main /me dashboard.
 */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';
import { CalendarClock, Users, Armchair, Wallet, ArrowLeft, Plus, CalendarOff } from 'lucide-react';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `My reservations · ${r.name}` : 'My reservations' };
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'muted' | 'destructive' | 'secondary'> = {
  PENDING: 'secondary',
  CONFIRMED: 'success',
  SEATED: 'default',
  COMPLETED: 'muted',
  CANCELLED: 'destructive',
  NO_SHOW: 'destructive',
};

export default async function MyReservationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true, status: true, dineInEnabled: true },
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  const session = await auth();
  if (!session?.user) redirect(`/r/${slug}/login`);
  if (session.user.role !== Role.CUSTOMER) redirect(`/r/${slug}/login`);

  const branchIds = (
    await prisma.branch.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } })
  ).map((b) => b.id);

  const reservations = branchIds.length
    ? await prisma.reservation.findMany({
        where: { customerId: session.user.id, branchId: { in: branchIds } },
        orderBy: { reservedAt: 'desc' },
        include: { table: { select: { name: true } } },
      })
    : [];

  return (
    <div className="bg-gradient-to-b from-primary/5 via-background to-background min-h-dvh pb-12">
      <div className="container max-w-2xl py-6 md:py-10 space-y-6">
        <div>
          <Link href={`/r/${slug}/me`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-4" /> Back to my account
          </Link>
          <div className="flex items-center justify-between gap-3 mt-2">
            <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight">My reservations</h1>
            {restaurant.dineInEnabled && (
              <Button asChild size="sm">
                <Link href={`/r/${slug}/reserve`}><Plus className="size-4" /> New</Link>
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Your table bookings at {restaurant.name}.</p>
        </div>

        {reservations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center space-y-3">
              <div className="mx-auto size-12 rounded-full bg-muted grid place-items-center">
                <CalendarOff className="size-6 text-muted-foreground" />
              </div>
              <div className="font-medium">No reservations yet</div>
              <p className="text-sm text-muted-foreground">
                When you book a table here, it&apos;ll show up for quick reference.
              </p>
              {restaurant.dineInEnabled && (
                <Button asChild className="mt-1">
                  <Link href={`/r/${slug}/reserve`}>Reserve a table</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {reservations.map((r) => {
              const when = r.reservedAt;
              return (
                <li key={r.id}>
                  <Card className="card-lift">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono font-semibold text-primary">{r.code}</span>
                        <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{r.status}</Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <Field icon={<CalendarClock className="size-3.5" />} label="When"
                          value={when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} />
                        <Field icon={<Users className="size-3.5" />} label="Party"
                          value={`${r.partySize} ${r.partySize === 1 ? 'guest' : 'guests'}`} />
                        <Field icon={<Armchair className="size-3.5" />} label="Table"
                          value={r.table?.name ?? '—'} />
                        <Field icon={<Wallet className="size-3.5" />} label="Deposit"
                          value={`${money(Number(r.depositAmount))}${r.depositPaid ? ' · paid' : ''}`} />
                      </dl>
                      {r.customerNotes && (
                        <p className="text-xs text-muted-foreground border-t pt-2">Note: {r.customerNotes}</p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</dt>
      <dd className="font-medium mt-0.5">{value}</dd>
    </div>
  );
}
