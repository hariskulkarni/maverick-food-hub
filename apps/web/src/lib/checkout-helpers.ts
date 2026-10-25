/**
 * Pure checkout helpers shared by the checkout form and the order tracker (no DOM, unit-tested).
 */

export type CheckoutMethod = 'RAZORPAY' | 'PHONEPE' | 'COD' | 'WALLET';

/**
 * The PaymentMethod to submit. A ₹0 order (wallet/points/discounts cover everything) is settled by
 * WALLET — the server refuses WALLET for anything still owed and refuses a gateway for ₹0.
 */
export function submitMethod(chosen: 'RAZORPAY' | 'PHONEPE' | 'COD', total: number | null | undefined): CheckoutMethod {
  return typeof total === 'number' && total <= 0 ? 'WALLET' : chosen;
}

/**
 * Customer-safe message from a failed API response body. The order API answers
 * `{ error, detail? }` (or plain text); never show raw JSON in a toast.
 */
export function apiErrorMessage(raw: string, fallback = 'Something went wrong. Please try again.'): string {
  const text = (raw || '').trim();
  if (!text) return fallback;
  try {
    const j = JSON.parse(text) as unknown;
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      // placeOrder's 500 carries the specific reason in `detail` ("Restaurant is closed…").
      const detail = typeof o.detail === 'string' ? o.detail : null;
      const error = typeof o.error === 'string' ? o.error : null;
      if (error && error !== 'Failed to place order') return error;
      if (detail) return detail;
      if (error) return error;
      if (Array.isArray(o.issues) || o.fieldErrors) return 'Some order details are invalid. Please review your cart.';
    }
    return fallback;
  } catch {
    // Plain text: show it unless it looks like markup / a stack.
    return text.length <= 200 && !text.startsWith('<') ? text : fallback;
  }
}

/** Order statuses from which the customer can (re)start an online payment. */
export const PAYABLE_ORDER_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_FAILED'] as const;

export function canPayNow(order: { status: string; paymentMethod?: string | null }): boolean {
  return (
    (PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status) &&
    (order.paymentMethod === 'RAZORPAY' || order.paymentMethod === 'PHONEPE')
  );
}
