import crypto from 'node:crypto';
import type { PaymentProvider } from './index';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

export function razorpayProvider(cfg?: RazorpayConfig): PaymentProvider {
  const keyId = cfg?.keyId ?? process.env.RAZORPAY_KEY_ID!;
  const keySecret = cfg?.keySecret ?? process.env.RAZORPAY_KEY_SECRET!;

  async function getClient() {
    const Razorpay = (await import('razorpay')).default;
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  return {
    name: 'razorpay',
    async createOrder(args) {
      const client = await getClient();
      const order = await client.orders.create({
        amount: Math.round(args.amount * 100), // paise
        currency: args.currency,
        receipt: args.orderId,
        notes: { customerPhone: args.customer.phone ?? '' }
      });
      return {
        providerName: 'razorpay',
        providerOrderId: order.id,
        amount: args.amount,
        currency: args.currency,
        publicKey: keyId,
        raw: order as unknown as Record<string, unknown>
      };
    },
    async verifyPayment(args) {
      const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${args.providerOrderId}|${args.providerPaymentId}`)
        .digest('hex');
      if (expected !== args.signature) return { ok: false, error: 'invalid signature' };
      return { ok: true, providerPaymentId: args.providerPaymentId };
    },
    async refund(args) {
      const client = await getClient();
      const r = await client.payments.refund(args.providerPaymentId, {
        amount: Math.round(args.amount * 100),
        notes: args.reason ? { reason: args.reason } : undefined
      });
      return { ok: true, providerRefundId: r.id };
    }
  };
}
