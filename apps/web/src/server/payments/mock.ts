import type { PaymentProvider } from './index';
import { nanoid } from 'nanoid';

export function mockProvider(): PaymentProvider {
  return {
    name: 'mock',
    async createOrder(args) {
      return {
        providerName: 'mock',
        providerOrderId: 'mock_order_' + nanoid(10),
        amount: args.amount,
        currency: args.currency,
        publicKey: 'mock_key',
        raw: { mock: true }
      };
    },
    async verifyPayment(_args) {
      return { ok: true, providerPaymentId: 'mock_pay_' + nanoid(10) };
    },
    async refund(args) {
      return { ok: true, providerRefundId: 'mock_ref_' + nanoid(10) };
    }
  };
}
