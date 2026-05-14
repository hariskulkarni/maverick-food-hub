/**
 * Pure-resolver tests for the signup-bonus engine.
 *
 * The full lifecycle (grant → apply → commit → restore) is integration-
 * tested via the orders state machine; this file nails down the math in
 * `computeBonusApply` so the per-order cap, balance, and remaining-orders
 * gates can't drift.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  computeBonusApply,
  remainingBalance,
  type SignupBonusGrantLite
} from '@/server/signup-bonus';

const NOW = new Date('2026-05-13T12:00:00');

function grant(partial: Partial<SignupBonusGrantLite> = {}): SignupBonusGrantLite {
  return {
    id: 'g1',
    userId: 'u1',
    totalAmount: 100,
    perOrderCap: 20,
    usedAmount: 0,
    pendingAmount: 0,
    remainingOrders: 5,
    expiresAt: null,
    revokedAt: null,
    ...partial
  };
}

describe('remainingBalance', () => {
  it('subtracts used + pending from total', () => {
    expect(remainingBalance(grant({ totalAmount: 100, usedAmount: 20, pendingAmount: 20 }))).toBe(60);
  });
  it('never goes negative', () => {
    expect(remainingBalance(grant({ totalAmount: 100, usedAmount: 200 }))).toBe(0);
  });
});

describe('computeBonusApply', () => {
  it('returns the per-order cap on a fresh grant', () => {
    const r = computeBonusApply(grant(), 500, NOW);
    expect(r.appliedAmount).toBe(20);
    expect(r.exhausted).toBe(false);
    expect(r.remainingBalance).toBe(100);
    expect(r.remainingOrders).toBe(5);
  });

  it('shrinks the per-order cap when remaining balance is smaller', () => {
    // Customer already used ₹90 across past orders, ₹10 left
    const r = computeBonusApply(grant({ usedAmount: 90 }), 500, NOW);
    expect(r.appliedAmount).toBe(10);
    expect(r.exhausted).toBe(false);
  });

  it('shrinks to the cart subtotal when the cart is smaller than the cap', () => {
    const r = computeBonusApply(grant(), 12, NOW);
    expect(r.appliedAmount).toBe(12);
  });

  it('refuses when remainingOrders has hit zero', () => {
    const r = computeBonusApply(grant({ remainingOrders: 0 }), 500, NOW);
    expect(r.appliedAmount).toBe(0);
    expect(r.exhausted).toBe(true);
    expect(r.reason).toMatch(/no orders/);
  });

  it('refuses when the grant has been revoked', () => {
    const r = computeBonusApply(grant({ revokedAt: new Date('2026-05-01') }), 500, NOW);
    expect(r.exhausted).toBe(true);
    expect(r.reason).toMatch(/revoked/);
  });

  it('refuses when the grant has expired', () => {
    const r = computeBonusApply(grant({ expiresAt: new Date('2026-01-01') }), 500, NOW);
    expect(r.exhausted).toBe(true);
    expect(r.reason).toMatch(/expired/);
  });

  it('treats a pending hold as already-reserved balance', () => {
    // ₹20 pending on an in-flight order — only ₹80 should be addressable
    const r = computeBonusApply(grant({ pendingAmount: 20 }), 500, NOW);
    expect(r.appliedAmount).toBe(20);          // per-order cap is still ₹20
    expect(r.remainingBalance).toBe(80);       // but the UI sees ₹80 left
  });

  it('returns zero with a friendly reason when no grant exists', () => {
    const r = computeBonusApply(null, 500, NOW);
    expect(r.appliedAmount).toBe(0);
    expect(r.exhausted).toBe(true);
    expect(r.reason).toMatch(/no grant/);
    expect(r.remainingBalance).toBe(0);
  });

  it('returns zero on an empty cart instead of negative', () => {
    const r = computeBonusApply(grant(), 0, NOW);
    expect(r.appliedAmount).toBe(0);
  });

  it('rounds applied amount to 2dp', () => {
    const g = grant({ perOrderCap: 33.333, totalAmount: 100, usedAmount: 33.333 });
    const r = computeBonusApply(g, 500, NOW);
    // perOrderCap ₹33.33 vs balance ₹66.67 → returns ₹33.33
    expect(r.appliedAmount).toBe(33.33);
  });

  it('survives lifetime simulation across 5 orders', () => {
    // Walk a customer through the whole 5-order window. Each iteration is a
    // pure-state transition mimicking commit:
    //   usedAmount += applied
    //   remainingOrders -= 1
    let g: SignupBonusGrantLite = grant();
    let totalApplied = 0;
    for (let i = 1; i <= 5; i++) {
      const r = computeBonusApply(g, 500, NOW);
      expect(r.appliedAmount).toBe(20);
      totalApplied += r.appliedAmount;
      g = { ...g, usedAmount: g.usedAmount + r.appliedAmount, remainingOrders: g.remainingOrders - 1 };
    }
    // 5th order consumes the last ₹20 → grant fully spent
    expect(totalApplied).toBe(100);
    expect(g.remainingOrders).toBe(0);
    const after = computeBonusApply(g, 500, NOW);
    expect(after.exhausted).toBe(true);
  });

  it('cancellation simulation: 3rd order cancelled before delivery restores balance and order count', () => {
    // After 2 commits: used=40, remaining=3
    let g: SignupBonusGrantLite = { ...grant(), usedAmount: 40, remainingOrders: 3 };
    // 3rd order placed → hold ₹20 pending
    g = { ...g, pendingAmount: 20 };
    expect(computeBonusApply(g, 500, NOW).remainingBalance).toBe(40);
    // 3rd order cancelled → release pending
    g = { ...g, pendingAmount: 0 };
    expect(computeBonusApply(g, 500, NOW).remainingBalance).toBe(60);
    expect(g.remainingOrders).toBe(3); // unchanged — never committed
  });
});
