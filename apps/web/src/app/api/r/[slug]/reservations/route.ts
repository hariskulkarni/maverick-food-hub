/**
 * Customer reservation collection endpoint for one restaurant (resolved by slug).
 *
 * GET  — list the signed-in customer's reservations at this branch (newest first).
 * POST — create + confirm a reservation. Requires a signed-in CUSTOMER.
 *
 * Deposit handling: mirrors the order checkout flow.
 *   - No deposit configured → confirm immediately (nothing to collect).
 *   - Cash on arrival       → confirm + hold the table; depositPaid stays false.
 *   - Online deposit (> 0)  → create a real Razorpay deposit order and return it
 *     UNCONFIRMED. The client runs checkout, then POSTs to
 *     /reservations/<id>/confirm-deposit, which verifies the payment signature
 *     before the reservation is confirmed. No deposit is ever marked collected
 *     without a verified gateway payment.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { createReservation, confirmReservation, attachDepositOrder } from '@/server/reservations';
import { paymentProvider } from '@/server/payments';
import { log } from '@/server/log';
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

  // Re-fetch the serialized reservation (with table name) for any response path.
  const finalize = async (status: number) => {
    const withTable = await prisma.reservation.findUniqueOrThrow({
      where: { id: created.id },
      include: { table: { select: { name: true } } },
    });
    return Response.json({ reservation: serializeReservation(withTable) }, { status });
  };

  const depositAmount = Number(created.depositAmount);

  // ── No deposit configured: nothing to collect, confirm + hold the table. ───
  if (depositAmount <= 0) {
    try {
      await confirmReservation(created.id, 'none', { paid: false });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 409 });
    }
    return finalize(201);
  }

  // ── Cash on arrival: hold the table now; deposit collected in person. ──────
  if (isCod) {
    try {
      await confirmReservation(created.id, 'cod', { paid: false });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 409 });
    }
    return finalize(201);
  }

  // ── Online deposit: create the gateway order, return it UNCONFIRMED. ───────
  // The reservation stays PENDING until /confirm-deposit verifies a payment.
  const customer = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, email: true },
  });
  let providerOrder;
  try {
    const provider = await paymentProvider(branch.restaurantId);
    providerOrder = await provider.createOrder({
      orderId: created.code,
      amount: depositAmount,
      currency: 'INR',
      customer: { name: customer?.name, phone: customer?.phone, email: customer?.email },
    });
    await attachDepositOrder(created.id, providerOrder.providerOrderId);
  } catch (e) {
    log.error({ err: (e as Error).message, reservationId: created.id }, 'reservation deposit order failed');
    return Response.json(
      { error: 'Could not start the deposit payment. Please try again.' },
      { status: 502 }
    );
  }

  const withTable = await prisma.reservation.findUniqueOrThrow({
    where: { id: created.id },
    include: { table: { select: { name: true } } },
  });
  return Response.json(
    {
      reservation: serializeReservation(withTable),
      deposit: {
        providerName: providerOrder.providerName,
        providerOrderId: providerOrder.providerOrderId,
        amount: providerOrder.amount,
        currency: providerOrder.currency,
        publicKey: providerOrder.publicKey ?? null,
      },
    },
    { status: 201 }
  );
}
