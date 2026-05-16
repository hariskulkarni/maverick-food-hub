import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';
import { normalizeOtp } from '@/lib/utils';

/**
 * Hand-over verification — the rider taps "Confirm delivery" with the code the
 * customer reads to them. Historically a strict `===` comparison was used here,
 * which is brittle: any stray whitespace, BOM, NBSP, or autofill bullet entered
 * by the keyboard caused a silent mismatch and the rider saw "code is
 * incorrect" even when the customer had read the right digits.
 *
 * The fix has three parts:
 *
 *   1. Normalise BOTH sides with `normalizeOtp` (strip non-digits) before
 *      comparing. The rider can paste, retype, or have autofill prefix a
 *      bullet — as long as the digits match, verification succeeds.
 *   2. Reject empty/short codes BEFORE comparison so we never accidentally
 *      pass-through on `'' === ''` if the order's OTP field is null.
 *   3. Log every failure with non-PII shape info (lengths only, never the
 *      actual codes) so the next "the code is incorrect" report has a
 *      diagnostic trail.
 */

const Body = z.object({ otp: z.string().min(1).max(16) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: true } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  let payload: { otp: string };
  try {
    payload = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, reason: 'malformed', message: 'Enter the code printed on the customer’s order.' }, { status: 400 });
  }

  const submitted = normalizeOtp(payload.otp);
  const expected = normalizeOtp(a.order.deliveryOtp);

  // No expected code on this order — refuse to verify rather than passing
  // through on '' === ''. This protects the (very rare) case where an order
  // was created before deliveryOtp generation existed.
  if (!expected) {
    console.warn('[deliver] missing expected OTP on order', { orderId: a.order.id, assignmentId: a.id });
    return Response.json(
      { ok: false, reason: 'missing-expected', message: 'No delivery code is set for this order. Contact support.' },
      { status: 400 }
    );
  }

  // Length / shape failure — gives a clearer message in the app.
  if (submitted.length < 4) {
    console.info('[deliver] short OTP submitted', {
      orderId: a.order.id,
      riderId: profile.id,
      submittedLen: submitted.length,
      rawLen: String(payload.otp ?? '').length,
    });
    return Response.json(
      { ok: false, reason: 'too-short', message: 'Enter at least 4 digits.' },
      { status: 400 }
    );
  }

  if (submitted !== expected) {
    // Audit log — lengths only, never the actual codes (those are PII for the
    // customer/order pair). Helps pinpoint future failures: if `rawLen` is
    // much larger than `submittedLen`, the keyboard injected non-digit chars
    // and normalisation saved the day; if both lengths match `expected.length`
    // and they still differ, the rider genuinely typed the wrong number.
    console.info('[deliver] OTP mismatch', {
      orderId: a.order.id,
      riderId: profile.id,
      submittedLen: submitted.length,
      expectedLen: expected.length,
      rawLen: String(payload.otp ?? '').length,
    });
    return Response.json(
      { ok: false, reason: 'mismatch', message: 'That code is incorrect. Ask the customer to read it again.' },
      { status: 400 }
    );
  }

  // Mark OTP verified and stamp delivery time on the assignment, then transition the order.
  // Bump rider's lifetime earnings by the assignment total (already set at claim time).
  await prisma.$transaction([
    prisma.order.update({ where: { id: a.order.id }, data: { deliveryOtpVerified: true } }),
    prisma.riderAssignment.update({ where: { id: a.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } }),
    prisma.riderProfile.update({
      where: { id: a.riderId },
      data: { totalEarnings: { increment: a.earningsAmt as any } }
    })
  ]);
  await transitionOrder(a.order.id, 'DELIVERED' as any, { actorId: session.user.id });
  return Response.json({ ok: true });
}
