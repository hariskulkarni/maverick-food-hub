import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { computeSettlementLine, type OrderLike, type SettlementConfig } from '@/server/settlement';

const cfg: SettlementConfig = { commissionPct: 18, paymentFeePct: 2 };

function order(over: Partial<OrderLike> = {}): OrderLike {
  return {
    id: 'o1', code: 'ORD-1', placedAt: new Date('2026-05-11T10:00:00Z'),
    status: 'DELIVERED' as any, paymentMethod: 'UPI', fulfillmentType: 'DELIVERY',
    discountConstruct: 'Promo', subtotal: 480, packagingFee: 15, deliveryFee: 0,
    discountAmount: 125, signupBonusApplied: 0, taxAmount: 24, ...over,
  };
}

describe('computeSettlementLine', () => {
  it('computes the full breakdown for a delivered online order', () => {
    const l = computeSettlementLine(order(), cfg);
    expect(l.netOrderValue).toBe(394);        // 480+15+0-125+24
    expect(l.commissionableValue).toBe(355);   // 480-125
    expect(l.commission).toBe(63.9);           // 355*18%
    expect(l.paymentFee).toBe(7.88);           // 394*2%
    expect(l.feeSubtotal).toBe(71.78);
    expect(l.gstOnFee).toBe(12.92);            // 71.78*18%
    expect(l.tcs).toBe(3.94);                  // 394*1%
    expect(l.tds).toBe(4.95);                  // (480+15)*1%
    expect(l.govtCharges).toBe(21.81);
    expect(l.netDeductions).toBe(93.59);
    expect(l.payout).toBe(300.41);             // 394-93.59
  });

  it('charges no payment fee on COD', () => {
    const l = computeSettlementLine(order({ paymentMethod: 'COD' }), cfg);
    expect(l.paymentFee).toBe(0);
    expect(l.feeSubtotal).toBe(l.commission);
  });

  it('zeroes financials for cancelled orders but keeps order facts', () => {
    const l = computeSettlementLine(order({ status: 'CANCELLED' as any }), cfg);
    expect(l.delivered).toBe(false);
    expect(l.netOrderValue).toBe(0);
    expect(l.payout).toBe(0);
    expect(l.subtotal).toBe(480); // raw facts retained
  });

  it('never makes commissionable value negative', () => {
    const l = computeSettlementLine(order({ subtotal: 100, discountAmount: 200, signupBonusApplied: 0 }), cfg);
    expect(l.commissionableValue).toBe(0);
    expect(l.commission).toBe(0);
  });

  it('respects per-restaurant commission %', () => {
    const l = computeSettlementLine(order(), { commissionPct: 20, paymentFeePct: 2 });
    expect(l.commission).toBe(71); // 355*20%
  });
});
