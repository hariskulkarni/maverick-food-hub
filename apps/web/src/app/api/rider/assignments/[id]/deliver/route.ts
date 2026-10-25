import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AssignmentStatus, OrderStatus } from '@prisma/client';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { applyIncentivesForDelivery } from '@/server/rider-payments';
import { normalizeOtp } from '@/lib/utils';
import { log } from '@/server/log';
import { rateLimit } from '@/server/http/rate-limit';
import { MAX_DELIVERY_OTP_ATTEMPTS, RIDER_DELIVERABLE_ORDER_STATES } from '@/server/rider-delivery-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hand-over verification — the rider taps "Confirm delivery" with the code the
 * customer reads to them.
 *
 *   1. Normalise BOTH sides with `normalizeOtp` (strip non-digits) before
 *      comparing, so keyboard junk (NBSP, BOM, autofill bullets) never causes a
 *      false mismatch. Empty/short codes are rejected before comparison.
 *   2. P1-5: at most MAX_DELIVERY_OTP_ATTEMPTS wrong codes per assignment
 *      (durable counter on the row, atomically incremented), plus a per-rider
 *      rate limit. On the cap the order moves to DELIVERY_OTP_FAILED (when the
 *      state machine allows it) and the rider is told to contact support.
 *   3. P0-1 / P0-2: idempotent and single-source. Payment, load release,
 *      delivery count and COD collection all happen inside transitionOrder's
 *      DELIVERED transaction, which flips the assignment with a conditional
 *      write — so a repeated POST (lost response, double tap) or a race can
 *      never pay twice, and a cancelled order can never be paid.
 *   4. Failures are logged with lengths only, never the codes.
 */

const Body = z.object({ otp: z.string().min(1).max(16) });

function fail(status: number, reason: string, message: string) {
  return Response.json({ ok: false, reason, message, error: message }, { status });
}

const LOCKED_MESSAGE = 'Too many incorrect codes. Contact Flavrly support to complete this delivery.';

function already() {
  return Response.json({ ok: true, alreadyDelivered: true, incentives: [], achievedBonuses: [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: true } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  // Idempotent replay: the hand-over already happened (e.g. the app lost the
  // response and retried). Report success without touching money.
  if (a.status === AssignmentStatus.DELIVERED) return already();

  if (a.status !== AssignmentStatus.ACCEPTED && a.status !== AssignmentStatus.PICKED_UP) {
    return fail(409, 'not-deliverable', 'This delivery is no longer assigned to you.');
  }
  if (!RIDER_DELIVERABLE_ORDER_STATES.includes(a.order.status)) {
    return fail(409, 'not-deliverable', 'Mark the order as picked up before confirming delivery.');
  }

  const rl = await rateLimit(req, { name: 'rider-deliver', key: profile.id, ignoreIp: true, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return fail(429, 'rate-limited', 'Too many attempts. Wait a minute and try again.');

  if (a.deliveryOtpAttempts >= MAX_DELIVERY_OTP_ATTEMPTS) return fail(429, 'too-many-attempts', LOCKED_MESSAGE);

  let payload: { otp: string };
  try {
    payload = Body.parse(await req.json());
  } catch {
    return fail(400, 'malformed', 'Enter the code printed on the customer’s order.');
  }

  const submitted = normalizeOtp(payload.otp);
  const expected = normalizeOtp(a.order.deliveryOtp);

  // No expected code on this order — refuse rather than pass on '' === ''.
  if (!expected) {
    log.warn({ orderId: a.order.id, assignmentId: a.id }, '[deliver] missing expected OTP on order');
    return fail(400, 'missing-expected', 'No delivery code is set for this order. Contact support.');
  }

  if (submitted.length < 4) {
    log.info(
      { orderId: a.order.id, riderId: profile.id, submittedLen: submitted.length, rawLen: String(payload.otp ?? '').length },
      '[deliver] short OTP submitted'
    );
    return fail(400, 'too-short', 'Enter at least 4 digits.');
  }

  if (submitted !== expected) {
    // Count the miss atomically; only a row still under the cap is incremented.
    const bumped = await prisma.riderAssignment.updateMany({
      where: { id: a.id, deliveryOtpAttempts: { lt: MAX_DELIVERY_OTP_ATTEMPTS } },
      data: { deliveryOtpAttempts: { increment: 1 } },
    });
    const after = await prisma.riderAssignment.findUnique({ where: { id: a.id }, select: { deliveryOtpAttempts: true } });
    const used = after?.deliveryOtpAttempts ?? MAX_DELIVERY_OTP_ATTEMPTS;
    log.info(
      {
        orderId: a.order.id,
        riderId: profile.id,
        submittedLen: submitted.length,
        expectedLen: expected.length,
        rawLen: String(payload.otp ?? '').length,
        attempts: used,
      },
      '[deliver] OTP mismatch'
    );
    if (bumped.count === 0 || used >= MAX_DELIVERY_OTP_ATTEMPTS) {
      // Lock reached — flag the order for support where the machine allows it
      // (RIDER_REACHED_CUSTOMER → DELIVERY_OTP_FAILED); otherwise the lock alone holds.
      await transitionOrder(a.orderId, OrderStatus.DELIVERY_OTP_FAILED, {
        actorId: session.user.id,
        eventSource: 'RIDER',
        note: `Delivery OTP failed ${MAX_DELIVERY_OTP_ATTEMPTS} times`,
      }).catch(() => {});
      return fail(429, 'too-many-attempts', LOCKED_MESSAGE);
    }
    const left = MAX_DELIVERY_OTP_ATTEMPTS - used;
    return fail(400, 'mismatch', `That code is incorrect. Ask the customer to read it again (${left} ${left === 1 ? 'try' : 'tries'} left).`);
  }

  // Verified. Record the OTP fact, then the DELIVERED transition is the
  // single-winner write that credits the rider.
  await prisma.order.update({ where: { id: a.order.id }, data: { deliveryOtpVerified: true } });
  try {
    await transitionOrder(a.order.id, OrderStatus.DELIVERED, { actorId: session.user.id, eventSource: 'RIDER', skipRiderIncentives: true });
  } catch (e) {
    if (!(e instanceof OrderTransitionError)) throw e;
    // Lost a race (concurrent retry or a cancellation). Report the truth.
    const now = await prisma.riderAssignment.findUnique({ where: { id: a.id }, select: { status: true } });
    if (now?.status === AssignmentStatus.DELIVERED) return already();
    return fail(409, 'not-deliverable', 'This order can no longer be delivered. Contact support.');
  }

  // Advance incentive progress and pay out any newly-achieved slabs. Idempotent
  // and best-effort — never blocks or fails the delivery confirmation.
  const incentives = await applyIncentivesForDelivery(a.riderId);
  const achieved = incentives.filter((i) => i.bonusCredited > 0);

  return Response.json({ ok: true, incentives, achievedBonuses: achieved });
}
