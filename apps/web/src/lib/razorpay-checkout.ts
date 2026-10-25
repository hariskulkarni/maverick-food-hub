/**
 * Razorpay Standard Checkout launcher (browser only).
 *
 * Opens checkout.js for a server-created Razorpay order. On success the handler's
 * `razorpay_order_id | razorpay_payment_id` HMAC signature is sent to POST /api/payments/verify,
 * which verifies it with the tenant's key secret and captures through the same helper as the
 * webhook (amount/over-collection guarded) — the browser never marks anything paid itself.
 * The webhook remains the source of truth if this tab closes before verify returns.
 */

type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void; on?: (e: string, cb: () => void) => void };

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const LOAD_TIMEOUT_MS = 8000;

function loadRazorpay(): Promise<RazorpayCtor | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: RazorpayCtor | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(w.Razorpay ?? null), LOAD_TIMEOUT_MS);
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      finish(w.Razorpay ?? null);
    };
    el.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    document.body.appendChild(el);
  });
}

export type RazorpayOutcome = 'PAID' | 'PENDING' | 'DISMISSED' | 'FAILED' | 'LOAD_FAILED';

export async function openRazorpayCheckout(args: {
  orderId: string;
  publicKey: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
}): Promise<RazorpayOutcome> {
  const RZ = await loadRazorpay();
  if (!RZ) return 'LOAD_FAILED';
  return new Promise<RazorpayOutcome>((resolve) => {
    const rzp = new RZ({
      key: args.publicKey,
      order_id: args.providerOrderId,
      amount: Math.round(args.amount * 100),
      currency: args.currency,
      name: args.name,
      description: args.description ?? 'Food order',
      handler: async (resp: { razorpay_order_id?: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          const r = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: args.orderId,
              providerOrderId: resp.razorpay_order_id ?? args.providerOrderId,
              providerPaymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            }),
          });
          const j = (await r.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean };
          resolve(r.ok && j.ok ? 'PAID' : r.status === 202 || j.pending ? 'PENDING' : 'FAILED');
        } catch {
          // Network blip after Razorpay took the money: the webhook settles it.
          resolve('PENDING');
        }
      },
      modal: { ondismiss: () => resolve('DISMISSED') },
      theme: { color: '#0a0a0a' },
    });
    rzp.open();
  });
}
