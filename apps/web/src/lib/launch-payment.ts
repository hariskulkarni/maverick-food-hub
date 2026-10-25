/**
 * Open the gateway checkout for a payment session returned by POST /api/orders or
 * POST /api/orders/[id]/pay (browser only). Shared by checkout and the order tracker's "Pay now".
 *
 * Nothing here decides that an order is paid: PhonePe and Flavrly PG are reconciled server-side
 * and the status page only polls; Razorpay's handler signature is verified by /api/payments/verify.
 */
import { openPhonePeCheckout } from './phonepe-checkout';
import { openRazorpayCheckout } from './razorpay-checkout';

export interface PaymentSessionLike {
  providerName: string;
  providerOrderId?: string;
  amount?: number;
  currency?: string;
  redirectUrl?: string | null;
  publicKey?: string | null;
  checkoutScriptUrl?: string | null;
}

export type LaunchResult =
  /** The browser is navigating to the gateway — do nothing else. */
  | { kind: 'redirected' }
  /** Route here next; `notice` is an optional customer message (success / still pending / cancelled). */
  | { kind: 'route'; href: string; notice?: { tone: 'success' | 'info' | 'error'; text: string } };

export async function launchPayment(orderId: string, payment: PaymentSessionLike, opts: { merchantName: string }): Promise<LaunchResult> {
  const orderHref = `/orders/${orderId}`;
  const statusHref = `/checkout/payment-status?orderId=${encodeURIComponent(orderId)}`;

  if (payment.providerName === 'mock') {
    await fetch(`/api/orders/${orderId}/confirm-mock-payment`, { method: 'POST' });
    return { kind: 'route', href: orderHref, notice: { tone: 'success', text: 'Payment captured (mock)' } };
  }

  if (payment.providerName === 'youpi' && payment.redirectUrl) {
    window.location.href = payment.redirectUrl;
    return { kind: 'redirected' };
  }

  if (payment.providerName === 'phonepe' && payment.redirectUrl) {
    // Iframe PayPage with full-redirect fallback; PhonePe returns via /api/payments/phonepe/return.
    const outcome = await openPhonePeCheckout({ tokenUrl: payment.redirectUrl, scriptUrl: payment.checkoutScriptUrl ?? undefined });
    if (outcome === 'REDIRECTED') return { kind: 'redirected' };
    // "Concluded" is not success — the status page asks the server.
    return { kind: 'route', href: statusHref };
  }

  if (payment.providerName === 'razorpay' && payment.publicKey && payment.providerOrderId) {
    const outcome = await openRazorpayCheckout({
      orderId,
      publicKey: payment.publicKey,
      providerOrderId: payment.providerOrderId,
      amount: payment.amount ?? 0,
      currency: payment.currency ?? 'INR',
      name: opts.merchantName,
    });
    switch (outcome) {
      case 'PAID':
        return { kind: 'route', href: orderHref, notice: { tone: 'success', text: 'Payment received. Your order is confirmed.' } };
      case 'PENDING':
        return { kind: 'route', href: orderHref, notice: { tone: 'info', text: 'Payment is being confirmed. This page updates automatically.' } };
      case 'DISMISSED':
        return { kind: 'route', href: orderHref, notice: { tone: 'info', text: 'Payment not completed. You can pay from your order page.' } };
      case 'LOAD_FAILED':
        return { kind: 'route', href: orderHref, notice: { tone: 'error', text: 'Could not load the payment window. Use “Pay now” on your order page.' } };
      default:
        return { kind: 'route', href: orderHref, notice: { tone: 'error', text: 'Payment failed. You can try again from your order page.' } };
    }
  }

  return { kind: 'route', href: orderHref, notice: { tone: 'error', text: 'We couldn’t open the payment page. Use “Pay now” on your order page.' } };
}
