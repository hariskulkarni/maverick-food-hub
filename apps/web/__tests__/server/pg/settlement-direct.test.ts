/**
 * Contract D14: Flavrly PG (direct-to-merchant UPI) settlement lines get no PSP fee,
 * no Flavrly payout, and show the commission as a receivable. Other rails unchanged.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { computeSettlementLine, type OrderLike, type SettlementConfig } from '@/server/settlement';

const cfg: SettlementConfig = { commissionPct: 18, paymentFeePct: 2 };
const order = (over: Partial<OrderLike> = {}): OrderLike => ({
  id: 'o1', code: 'ORD-1', placedAt: new Date('2026-05-11T10:00:00Z'),
  status: 'DELIVERED' as any, paymentMethod: 'PHONEPE', fulfillmentType: 'DELIVERY',
  discountConstruct: 'Promo', subtotal: 480, packagingFee: 15, deliveryFee: 0,
  discountAmount: 125, signupBonusApplied: 0, taxAmount: 24, ...over,
});

describe('settlement: direct-to-merchant (youpi) vs aggregator rails', () => {
  it.each(['PHONEPE', 'RAZORPAY'])('%s numbers are unchanged (same as the existing baseline)', (m) => {
    const l = computeSettlementLine(order({ paymentMethod: m }), cfg);
    expect(l).toMatchObject({
      settlementMode: 'PLATFORM_COLLECTED', netOrderValue: 394, commission: 63.9, paymentFee: 7.88,
      gstOnFee: 12.92, tcs: 3.94, tds: 4.95, netDeductions: 93.59, payout: 300.41,
      collectedByMerchant: 0, commissionReceivable: 0,
    });
    expect(computeSettlementLine(order({ paymentMethod: m, directToMerchant: false }), cfg)).toEqual(l);
  });

  it('COD stays fee-free and platform-collected', () => {
    const l = computeSettlementLine(order({ paymentMethod: 'COD' }), cfg);
    expect(l).toMatchObject({ paymentFee: 0, settlementMode: 'PLATFORM_COLLECTED', commissionReceivable: 0 });
    expect(l.payout).toBeGreaterThan(0);
  });

  it('youpi: no payment fee, no Flavrly payout, deductions become a receivable', () => {
    const l = computeSettlementLine(order({ directToMerchant: true }), cfg);
    expect(l.settlementMode).toBe('DIRECT_TO_MERCHANT');
    expect(l.paymentFee).toBe(0);
    expect(l.commission).toBe(63.9); // commission itself unchanged
    expect(l.gstOnFee).toBe(11.5); // 63.9 * 18%
    expect(l.payout).toBe(0);
    expect(l.collectedByMerchant).toBe(394);
    expect(l.commissionReceivable).toBe(l.netDeductions);
    // E = A - C + D - F + G holds
    expect(l.netOrderValue - l.netDeductions + l.netAdditions - l.collectedByMerchant + l.commissionReceivable).toBeCloseTo(l.payout, 2);
  });

  it('youpi non-delivered order carries nothing', () => {
    const l = computeSettlementLine(order({ directToMerchant: true, status: 'CANCELLED_BY_CUSTOMER' as any }), cfg);
    expect(l).toMatchObject({ payout: 0, collectedByMerchant: 0, commissionReceivable: 0, settlementMode: 'DIRECT_TO_MERCHANT' });
  });
});
