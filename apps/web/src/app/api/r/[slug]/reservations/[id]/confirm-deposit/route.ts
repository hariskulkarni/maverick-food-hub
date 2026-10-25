/**
 * POST /api/r/[slug]/reservations/[id]/confirm-deposit
 *
 * Completes an ONLINE reservation deposit. The booking POST created a Razorpay
 * deposit order and left the reservation PENDING; the client runs checkout and
 * then calls this endpoint with the gateway payment id + signature. We verify
 * the signature against the exact order we created (mirroring
 * /api/payments/verify) before confirming the reservation — so a deposit is
 * never marked collected without a real, verified payment.
 *
 * PhonePe: no browser signature exists; the deposit is confirmed only when the Order Status API
 * reports the deposit's merchantOrderId CAPTURED for the deposit amount (202 while pending).
 *
 * Mock provider (dev / no Razorpay creds): the signature step is skipped and
 * the reservation is confirmed directly, matching the order flow's
 * confirm-mock-payment path. The bypass is keyed off the resolved provider's
 * name — never off client input — so it can't be abused against a live gateway.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role, ReservationStatus } from '@prisma/client';
import { paymentProvider } from '@/server/payments';
import { confirmReservation } from '@/server/reservations';
import { serializeReservation } from '../../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user || session.user.role !== Role.CUSTOMER) {
    return Response.json({ error: 'Sign in to confirm your reservation' }, { status: 401 });
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      customerId: true,
      status: true,
      depositPaid: true,
      depositProviderOrderId: true,
      depositAmount: true,
      branch: { select: { restaurantId: true } },
    },
  });
  if (!reservation || reservation.customerId !== session.user.id) {
    return Response.json({ error: 'Reservation not found' }, { status: 404 });
  }

  const respond = async (status: number) => {
    const withTable = await prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: { table: { select: { name: true } } },
    });
    return Response.json({ reservation: serializeReservation(withTable) }, { status });
  };

  // Idempotent: already paid → just return the current state.
  if (reservation.depositPaid) return respond(200);

  if (
    reservation.status !== ReservationStatus.PENDING &&
    reservation.status !== ReservationStatus.CONFIRMED
  ) {
    return Response.json(
      { error: `Reservation cannot be confirmed from status ${reservation.status}` },
      { status: 409 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const provider = await paymentProvider(reservation.branch.restaurantId);

  // Mock provider: confirm directly (no real gateway). Decided by provider name,
  // not by any client-supplied flag.
  if (provider.name === 'mock') {
    await confirmReservation(id, 'mock', { paid: true });
    return respond(200);
  }

  if (!reservation.depositProviderOrderId) {
    return Response.json({ error: 'No pending deposit for this reservation' }, { status: 400 });
  }

  // P1-11 PhonePe: nothing signable comes back to the browser. Ask PhonePe's Order Status API about
  // the exact merchantOrderId we created; only a CAPTURED answer for the deposit amount confirms.
  if (provider.name === 'phonepe') {
    const v = await provider.verifyPayment({ merchantOrderId: reservation.depositProviderOrderId });
    if (v.ok && v.status === 'CAPTURED') {
      if (typeof v.amount === 'number' && Math.round(v.amount * 100) !== Math.round(Number(reservation.depositAmount) * 100)) {
        return Response.json({ error: 'Deposit amount mismatch. Please contact the restaurant.' }, { status: 409 });
      }
      await confirmReservation(id, v.providerPaymentId ?? reservation.depositProviderOrderId, { paid: true });
      return respond(200);
    }
    if (v.status === 'PENDING' || v.status === 'UNKNOWN' || !v.status) {
      return Response.json({ pending: true, error: 'Your deposit payment is still being confirmed.' }, { status: 202 });
    }
    return Response.json({ error: v.error || 'Deposit payment failed' }, { status: 400 });
  }

  // Razorpay: require + verify the checkout handler signature.
  const providerPaymentId = typeof body.providerPaymentId === 'string' ? body.providerPaymentId : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!providerPaymentId || !signature) {
    return Response.json({ error: 'Missing payment confirmation details' }, { status: 400 });
  }

  const verified = await provider.verifyPayment({
    providerOrderId: reservation.depositProviderOrderId,
    providerPaymentId,
    signature,
  });
  if (!verified.ok) {
    return Response.json({ error: verified.error || 'Payment verification failed' }, { status: 400 });
  }

  await confirmReservation(id, providerPaymentId, { paid: true });
  return respond(200);
}
