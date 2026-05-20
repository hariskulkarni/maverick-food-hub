/**
 * Dine-in reservation engine.
 *
 * Owns the availability + booking logic for table reservations:
 *   - findAvailableTables: which tables can host a party at a slot (capacity +
 *     no time-overlap with an existing live booking).
 *   - createReservation: book a specific table, snapshotting the restaurant's
 *     current deposit + discount %.
 *   - confirm / cancel / seat / complete / noShow lifecycle helpers.
 *
 * Double-booking prevention: two reservations conflict when they're on the
 * SAME table and their [start, start+duration) windows intersect. We treat
 * PENDING, CONFIRMED and SEATED as "live" (blocking); CANCELLED / NO_SHOW /
 * COMPLETED free the slot. The create path re-checks availability inside a
 * transaction so two concurrent bookings can't both grab the same table.
 */

import { prisma } from './db';
import { ReservationStatus, Prisma } from '@prisma/client';

const RSV_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function genReservationCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += RSV_ALPHABET[Math.floor(Math.random() * RSV_ALPHABET.length)];
  return `RSV-${s}`;
}

/** Statuses that still hold a table (block the slot for other bookings). */
const LIVE_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.SEATED,
];

/**
 * Do two reservation windows on the SAME table collide?
 *
 * Each window is [start, start + durationMin). Two half-open intervals overlap
 * iff aStart < bEnd AND bStart < aEnd. Back-to-back bookings (one ends exactly
 * when the next begins) do NOT collide — that's the half-open boundary working
 * as intended (a table freed at 8:00 can be re-seated at 8:00).
 *
 * Pure + side-effect-free so it's unit-testable in isolation; both
 * findAvailableTables and the createReservation commit-time re-check call it.
 */
export function reservationsOverlap(
  aStartMs: number,
  aDurationMin: number,
  bStartMs: number,
  bDurationMin: number
): boolean {
  const aEnd = aStartMs + aDurationMin * 60_000;
  const bEnd = bStartMs + bDurationMin * 60_000;
  return aStartMs < bEnd && bStartMs < aEnd;
}

export interface AvailabilityQuery {
  branchId: string;
  partySize: number;
  reservedAt: Date;
  durationMin: number;
}

export interface AvailableTable {
  id: string;
  name: string;
  capacity: number;
}

/**
 * Tables at the branch that can host `partySize` at `reservedAt` for
 * `durationMin`, with no overlapping live reservation. Returned smallest-
 * capacity-first so the booking engine can prefer the tightest fit (keeps big
 * tables free for big parties).
 */
export async function findAvailableTables(q: AvailabilityQuery): Promise<AvailableTable[]> {
  const start = q.reservedAt;
  const end = new Date(start.getTime() + q.durationMin * 60_000);

  // Candidate tables: active + big enough for the party.
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId: q.branchId, isActive: true, capacity: { gte: q.partySize } },
    orderBy: [{ capacity: 'asc' }, { sortOrder: 'asc' }],
  });
  if (tables.length === 0) return [];

  // All live reservations on those tables that could overlap the requested
  // window. Overlap test: existing.start < requestedEnd AND requestedStart <
  // existing.end. We can't express "start + durationMin" in a Prisma filter
  // directly, so we over-fetch by a coarse time bound, then filter in JS.
  const tableIds = tables.map((t) => t.id);
  const coarseFrom = new Date(start.getTime() - 6 * 60 * 60_000); // 6h before
  const coarseTo = end;
  const live = await prisma.reservation.findMany({
    where: {
      tableId: { in: tableIds },
      status: { in: LIVE_STATUSES },
      reservedAt: { gte: coarseFrom, lt: coarseTo.getTime() > coarseFrom.getTime() ? new Date(end.getTime() + 6 * 60 * 60_000) : coarseTo },
    },
    select: { tableId: true, reservedAt: true, durationMin: true },
  });

  const conflicted = new Set<string>();
  for (const r of live) {
    if (reservationsOverlap(start.getTime(), q.durationMin, r.reservedAt.getTime(), r.durationMin)) {
      conflicted.add(r.tableId);
    }
  }

  return tables
    .filter((t) => !conflicted.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, capacity: t.capacity }));
}

export interface CreateReservationInput {
  branchId: string;
  customerId: string;
  tableId: string;
  partySize: number;
  reservedAt: Date;
  durationMin?: number;
  customerNotes?: string;
}

/**
 * Book a specific table. Re-validates capacity + availability inside a
 * transaction (the table must still be free at commit time). Snapshots the
 * restaurant's current deposit + discount %. Returns the created reservation
 * (status PENDING — deposit not yet paid).
 */
export async function createReservation(input: CreateReservationInput) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: input.branchId },
    include: { restaurant: { select: { dineInEnabled: true, reservationDeposit: true, reservationDiscountPct: true, reservationDurationMin: true } } },
  });
  if (!branch.restaurant.dineInEnabled) {
    throw new Error('This restaurant is not accepting dine-in reservations');
  }
  const durationMin = input.durationMin ?? branch.restaurant.reservationDurationMin;
  if (input.reservedAt.getTime() <= Date.now()) {
    throw new Error('Reservation time must be in the future');
  }

  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findUnique({ where: { id: input.tableId } });
    if (!table || table.branchId !== input.branchId || !table.isActive) {
      throw new Error('Selected table is not available');
    }
    if (table.capacity < input.partySize) {
      throw new Error(`Table seats ${table.capacity}; party of ${input.partySize} is too large`);
    }
    // Re-check overlap at commit time.
    const start = input.reservedAt;
    const live = await tx.reservation.findMany({
      where: { tableId: input.tableId, status: { in: LIVE_STATUSES } },
      select: { reservedAt: true, durationMin: true },
    });
    const clash = live.some((r) =>
      reservationsOverlap(start.getTime(), durationMin, r.reservedAt.getTime(), r.durationMin)
    );
    if (clash) throw new Error('That table was just booked for an overlapping time — pick another slot or table');

    return tx.reservation.create({
      data: {
        code: genReservationCode(),
        branchId: input.branchId,
        customerId: input.customerId,
        tableId: input.tableId,
        partySize: input.partySize,
        reservedAt: input.reservedAt,
        durationMin,
        status: ReservationStatus.PENDING,
        depositAmount: branch.restaurant.reservationDeposit as Prisma.Decimal,
        discountPct: branch.restaurant.reservationDiscountPct,
        customerNotes: input.customerNotes,
      },
    });
  });
}

/** Mark the deposit paid + move PENDING → CONFIRMED. */
export async function confirmReservation(id: string, depositPaymentRef: string) {
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id } });
  if (r.status !== ReservationStatus.PENDING && r.status !== ReservationStatus.CONFIRMED) {
    throw new Error(`Reservation cannot be confirmed from status ${r.status}`);
  }
  return prisma.reservation.update({
    where: { id },
    data: { status: ReservationStatus.CONFIRMED, depositPaid: true, depositPaymentRef },
  });
}

export async function cancelReservation(id: string, by: string, reason?: string) {
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id } });
  if (r.status === ReservationStatus.COMPLETED) throw new Error('Completed reservations cannot be cancelled');
  return prisma.reservation.update({
    where: { id },
    data: { status: ReservationStatus.CANCELLED, cancelledBy: by, cancelReason: reason ?? null },
  });
}

export async function markReservationSeated(id: string) {
  return prisma.reservation.update({ where: { id }, data: { status: ReservationStatus.SEATED } });
}

export async function markReservationCompleted(id: string) {
  return prisma.reservation.update({ where: { id }, data: { status: ReservationStatus.COMPLETED } });
}

export async function markReservationNoShow(id: string) {
  return prisma.reservation.update({ where: { id }, data: { status: ReservationStatus.NO_SHOW } });
}
