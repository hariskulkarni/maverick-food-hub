import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { ReservationsClient } from './reservations-client';
import { NoBranchNotice } from '../no-branch-notice';

export const metadata = { title: 'Admin · Reservations' };
export const dynamic = 'force-dynamic';

export default async function ReservationsPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) return <NoBranchNotice />;

  const reservations = await prisma.reservation.findMany({
    where: { branchId: branch.id },
    orderBy: { reservedAt: 'asc' },
    include: {
      table: { select: { id: true, name: true, capacity: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } }
    }
  });

  return (
    <ReservationsClient
      dineInEnabled={restaurant.dineInEnabled}
      initial={JSON.parse(JSON.stringify(reservations))}
    />
  );
}
