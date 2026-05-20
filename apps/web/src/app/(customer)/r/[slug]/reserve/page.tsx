/**
 * /r/[slug]/reserve — customer-facing "reserve a table" page.
 *
 * Server component: resolves the restaurant + active branch by slug, gates on
 * `dineInEnabled` (shows a friendly "not available" card when off), and hands
 * the dine-in config + auth state to the booking client. The actual
 * availability check + booking happen via the /api/r/[slug]/reservations API.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarOff, ArrowLeft } from 'lucide-react';
import { ReserveClient } from './reserve-client';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `Reserve a table · ${r.name}` : 'Reserve a table' };
}

export default async function ReservePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      status: true,
      dineInEnabled: true,
      reservationDeposit: true,
      reservationDiscountPct: true,
      reservationDurationMin: true,
    },
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, city: true },
  });
  if (!branch) return notFound();

  const session = await auth();
  const isAuthedCustomer = Boolean(session?.user && session.user.role === Role.CUSTOMER);

  // Dine-in disabled → friendly message instead of the booking flow.
  if (!restaurant.dineInEnabled) {
    return (
      <div className="container max-w-2xl py-12">
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-3">
            <div className="mx-auto size-12 rounded-full bg-muted grid place-items-center">
              <CalendarOff className="size-6 text-muted-foreground" />
            </div>
            <h1 className="display text-2xl font-semibold">Reservations not available here</h1>
            <p className="text-sm text-muted-foreground">
              {restaurant.name} isn&apos;t taking dine-in table reservations right now. You can still
              order for delivery or pickup.
            </p>
            <Button asChild variant="outline" className="mt-2">
              <Link href={`/r/${slug}`}><ArrowLeft className="size-4" /> Back to menu</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8 md:py-12">
      <div className="mb-6">
        <Link href={`/r/${slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Back to {restaurant.name}
        </Link>
        <h1 className="display text-3xl font-semibold tracking-tight mt-2">Reserve a table</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Book a table at {restaurant.name}{branch.city ? ` · ${branch.city}` : ''}.
        </p>
      </div>

      <ReserveClient
        slug={slug}
        restaurantName={restaurant.name}
        isAuthedCustomer={isAuthedCustomer}
        depositAmount={Number(restaurant.reservationDeposit)}
        discountPct={restaurant.reservationDiscountPct}
        defaultDurationMin={restaurant.reservationDurationMin}
      />
    </div>
  );
}
