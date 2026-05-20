/**
 * Customer reservation collection endpoint for one restaurant (resolved by slug).
 *
 * GET  — list the signed-in customer's reservations at this branch (newest first).
 * POST — create + confirm a reservation. Requires a signed-in CUSTOMER.
 *
 * Deposit handling (this build): the reservation deposit is treated as
 * collected through the customer's chosen payment method. For cash-on-arrival
 * we confirm immediately with ref 'cod'; for an online method we confirm with
 * ref 'demo'. Full Razorpay deposit capture (order create → client checkout →
 * webhook-verified confirm) is OUT OF SCOPE here — see the TODO below before
 * shipping real money handling.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { createReservation, confirmReservation } from '@/server/reservations';
import { resolveBranchForSlug, serializeReservation } from './_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const branch = await resolveBranchForSlug(slug);
  if (!branch) return Response.json({ error: 'Restaurant not found' }, { status: 404 });

  const session = await auth();
  if (!session?.user || session.user.role !== Role.CUSTOMER) {
    return Response.json({ error: 'Sign in to view your reservations' }, { status: 401 });
  }

  const reservations = await prisma.reservation.findMany({
    where: { branchId: branch.branchId, customerId: session.user.id },
    orderBy: { reservedAt: 'desc' },
    include: { table: { select: { name: true } } },
  });

  return Response.json({ reservations: reservations.map(serializeReservation) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const branch = await resolveBranchForSlug(slug);
  if (!branch) return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  if (!branch.dineInEnabled) {
    return Response.json({ error: 'Reservations are not available here' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user || session.user.role !== Role.CUSTOMER) {
    return Response.json({ error: 'Sign in to book a table' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tableId = typeof body.tableId === 'string' ? body.tableId : '';
  if (!tableId) return Response.json({ error: 'tableId is required' }, { status: 400 });

  const partySize = Number(body.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    return Response.json({ error: 'partySize must be an integer between 1 and 50' }, { status: 400 });
  }

  const reservedAt = typeof body.reservedAt === 'string' ? new Date(body.reservedAt) : null;
  if (!reservedAt || Number.isNaN(reservedAt.getTime())) {
    return Response.json({ error: 'reservedAt must be a valid ISO datetime' }, { status: 400 });
  }

  let durationMin: number | undefined;
  if (body.durationMin != null && body.durationMin !== '') {
    const d = Number(body.durationMin);
    if (!Number.isInteger(d) || d < 15 || d > 600) {
      return Response.json({ error: 'durationMin must be an integer between 15 and 600' }, { status: 400 });
    }
    durationMin = d;
  }

  const customerNotes =
    typeof body.customerNotes === 'string' && body.customerNotes.trim()
      ? body.customerNotes.trim().slice(0, 500)
      : undefined;

  // paymentMethod drives the deposit ref. Anything that isn't an explicit
  // cash/COD choice is treated as an online payment in this build.
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.toLowerCase() : 'online';
  const isCod = paymentMethod === 'cod' || paymentMethod === 'cash' || paymentMethod === 'cash-on-arrival';

  let created;
  try {
    created = await createReservation({
      branchId: branch.branchId,
      customerId: session.user.id,
      tableId,
      partySize,
      reservedAt,
      durationMin,
      customerNotes,
    });
  } catch (e) {
    // createReservation throws on closed/conflict/too-large — surface as a 409
    // so the client can prompt the customer to pick another slot or table.
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }

  // Deposit collection.
  // TODO(payments): for an online deposit, replace the 'demo' confirm below with
  // a real Razorpay flow — create a deposit order, run client-side checkout,
  // verify the signature server-side (mirror /api/payments/verify), and only
  // then call confirmReservation(created.id, <razorpay_payment_id>). For now we
  // confirm optimistically so the booking UX is end-to-end demoable.
  const depositRef = isCod ? 'cod' : 'demo';
  let confirmed;
  try {
    confirmed = await confirmReservation(created.id, depositRef);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }

  const withTable = await prisma.reservation.findUniqueOrThrow({
    where: { id: confirmed.id },
    include: { table: { select: { name: true } } },
  });

  return Response.json({ reservation: serializeReservation(withTable) }, { status: 201 });
}
