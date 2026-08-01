/**
 * PhonePe return URL — where the customer's browser lands when the PayPage
 * concludes (success, failure, or cancel).
 *
 * This is an API route rather than a page for two reasons: PhonePe has been
 * observed returning by both GET and POST depending on the payment mode, and a
 * Next.js page cannot accept a POST. So we take either verb, reconcile, and
 * 303-redirect the browser to a real page.
 *
 * Untrusted: `ref` is a merchantOrderId supplied by whoever opened the URL. It
 * is only used to look up a Payment row; the outcome comes from PhonePe's Order
 * Status API. A stranger hitting this endpoint with someone else's ref can, at
 * worst, cause a reconciliation that would have happened anyway.
 */
import { NextRequest } from 'next/server';
import { log } from '@/server/log';
import { findPhonePePayment, reconcilePhonePePayment } from '@/server/payments/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref') ?? '';
  const origin = url.origin;

  if (!ref) return Response.redirect(`${origin}/orders`, 303);

  const payment = await findPhonePePayment(ref);
  if (!payment) {
    log.warn({ ref }, 'PhonePe return: unknown merchant order id');
    return Response.redirect(`${origin}/orders`, 303);
  }

  // Best-effort: the landing page polls too, so a slow gateway here just means
  // the customer sees "confirming…" for a moment instead of an error.
  try {
    await reconcilePhonePePayment(payment.id);
  } catch (e) {
    log.warn({ err: (e as Error).message, ref }, 'PhonePe return: reconcile failed');
  }

  return Response.redirect(
    `${origin}/checkout/payment-status?orderId=${encodeURIComponent(payment.orderId)}&ref=${encodeURIComponent(ref)}`,
    303,
  );
}

export const GET = handle;
export const POST = handle;
