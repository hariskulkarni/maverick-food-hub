/**
 * Shared helpers for the customer reservation API routes.
 *
 * route.ts files may export only HTTP handlers, so the branch resolver +
 * reservation serializer live here. A reservation carries Decimal columns
 * (depositAmount) which must be converted to plain numbers before crossing the
 * JSON boundary to the client.
 */
import { prisma } from '@/server/db';

/**
 * Resolve the first active branch for a restaurant slug. Returns the branch +
 * the dine-in config snapshot the reservation flow needs (deposit, discount,
 * default duration, whether dine-in is even enabled). Returns null when the
 * slug is unknown / inactive or the restaurant has no active branch — callers
 * turn that into a 404.
 */
export async function resolveBranchForSlug(slug: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      dineInEnabled: true,
      reservationDeposit: true,
      reservationDiscountPct: true,
      reservationDurationMin: true,
    },
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') return null;

  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!branch) return null;

  return {
    branchId: branch.id,
    restaurantId: restaurant.id,
    dineInEnabled: restaurant.dineInEnabled,
    reservationDeposit: Number(restaurant.reservationDeposit),
    reservationDiscountPct: restaurant.reservationDiscountPct,
    reservationDurationMin: restaurant.reservationDurationMin,
  };
}

export interface SerializedReservation {
  id: string;
  code: string;
  partySize: number;
  reservedAt: string;
  durationMin: number;
  status: string;
  depositAmount: number;
  depositPaid: boolean;
  discountPct: number;
  customerNotes: string | null;
  tableId: string;
  tableName: string | null;
  createdAt: string;
}

/** Serialize a reservation row (with optional `table` relation) for the client. */
export function serializeReservation(r: {
  id: string;
  code: string;
  partySize: number;
  reservedAt: Date;
  durationMin: number;
  status: string;
  depositAmount: { toString(): string };
  depositPaid: boolean;
  discountPct: number;
  customerNotes: string | null;
  tableId: string;
  table?: { name: string } | null;
  createdAt: Date;
}): SerializedReservation {
  return {
    id: r.id,
    code: r.code,
    partySize: r.partySize,
    reservedAt: r.reservedAt.toISOString(),
    durationMin: r.durationMin,
    status: r.status,
    depositAmount: Number(r.depositAmount),
    depositPaid: r.depositPaid,
    discountPct: r.discountPct,
    customerNotes: r.customerNotes,
    tableId: r.tableId,
    tableName: r.table?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
