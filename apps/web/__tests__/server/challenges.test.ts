/**
 * Pure-progress tests for the gamified-offer challenge engine.
 *
 * We focus on `applyOrderToProgress` + the gating helpers (`orderIsEligible`,
 * `orderIsInChallengeWindow`, `orderMeetsMinimum`). The DB-aware hook is
 * exercised by the orders-state-machine integration tests; this file makes
 * the math auditable.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  applyOrderToProgress,
  orderIsEligible,
  orderIsInChallengeWindow,
  orderMeetsMinimum,
  percentComplete,
  type ChallengeLite, type OrderForProgress, type ProgressState
} from '@/server/challenges';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-13T13:00:00'); // Wed

function challenge(partial: Partial<ChallengeLite>): ChallengeLite {
  return {
    id: 'c-' + Math.random().toString(36).slice(2, 7),
    name: 'Test Challenge',
    description: null,
    type: 'ORDER_COUNT',
    target: 3,
    window: 'LIFETIME',
    minOrderValue: null,
    rewardType: 'FIXED_OFF',
    rewardValue: 100,
    rewardMaxDiscount: null,
    rewardValidityDays: 30,
    validFrom: new Date('2025-01-01'),
    validTo: null,
    isActive: true,
    priority: 0,
    perCustomerLimit: 1,
    phoneVerifiedOnly: true,
    totalLimit: null,
    totalIssued: 0,
    brandId: null, restaurantId: null,
    ...partial
  };
}

function order(partial: Partial<OrderForProgress> = {}): OrderForProgress {
  return {
    id: 'o-' + Math.random().toString(36).slice(2, 7),
    customerId: 'u1',
    total: 500,
    placedAt: NOW,
    restaurantId: 'r-italia',
    brandId: null,
    ...partial
  };
}

function emptyProgress(): ProgressState {
  return { value: 0, metadata: {}, completed: false };
}

// ── Gating ────────────────────────────────────────────────────────────────

describe('orderIsInChallengeWindow', () => {
  it('LIFETIME challenges always pass when in validity range', () => {
    expect(orderIsInChallengeWindow(challenge({ window: 'LIFETIME' }), order(), NOW)).toBe(true);
  });

  it('rejects orders before validFrom', () => {
    expect(orderIsInChallengeWindow(challenge({ validFrom: new Date('2099-01-01') }), order(), NOW)).toBe(false);
  });

  it('rejects orders after validTo', () => {
    expect(orderIsInChallengeWindow(challenge({ validTo: new Date('2025-01-01') }), order(), NOW)).toBe(false);
  });

  it('MONTHLY: rejects orders from a different calendar month than the reference', () => {
    // Order on 2026-04-30, reference 2026-05-13 → different months
    const o = order({ placedAt: new Date('2026-04-30T13:00:00') });
    expect(orderIsInChallengeWindow(challenge({ window: 'MONTHLY' }), o, NOW)).toBe(false);
  });

  it('MONTHLY: accepts orders within the same calendar month', () => {
    const o = order({ placedAt: new Date('2026-05-01T13:00:00') });
    expect(orderIsInChallengeWindow(challenge({ window: 'MONTHLY' }), o, NOW)).toBe(true);
  });

  it('WEEKLY: accepts orders within the same Sunday-of-week', () => {
    const o = order({ placedAt: new Date('2026-05-12T13:00:00') }); // Tuesday — same week as Wed
    expect(orderIsInChallengeWindow(challenge({ window: 'WEEKLY' }), o, NOW)).toBe(true);
  });

  it('WEEKLY: rejects orders from the previous week', () => {
    const o = order({ placedAt: new Date('2026-05-05T13:00:00') }); // Tue, previous week
    expect(orderIsInChallengeWindow(challenge({ window: 'WEEKLY' }), o, NOW)).toBe(false);
  });
});

describe('orderMeetsMinimum', () => {
  it('passes when no minimum is set', () => {
    expect(orderMeetsMinimum(challenge({ minOrderValue: null }), order({ total: 50 }))).toBe(true);
  });
  it('rejects orders below the minimum', () => {
    expect(orderMeetsMinimum(challenge({ minOrderValue: 200 }), order({ total: 100 }))).toBe(false);
  });
  it('accepts orders exactly at the minimum', () => {
    expect(orderMeetsMinimum(challenge({ minOrderValue: 200 }), order({ total: 200 }))).toBe(true);
  });
});

describe('orderIsEligible (combined gate)', () => {
  it('rejects below-minimum orders even when window passes', () => {
    expect(orderIsEligible(challenge({ minOrderValue: 1000 }), order({ total: 100 }), NOW)).toBe(false);
  });
  it('rejects out-of-window orders even when min passes', () => {
    expect(orderIsEligible(
      challenge({ window: 'MONTHLY', minOrderValue: 0 }),
      order({ placedAt: new Date('2026-04-01') }),
      NOW
    )).toBe(false);
  });
});

// ── ORDER_COUNT ───────────────────────────────────────────────────────────

describe('ORDER_COUNT', () => {
  it('increments value by 1 per qualifying order', () => {
    const c = challenge({ type: 'ORDER_COUNT', target: 3 });
    const { next, justCompleted } = applyOrderToProgress(c, emptyProgress(), order(), NOW);
    expect(next.value).toBe(1);
    expect(next.completed).toBe(false);
    expect(justCompleted).toBe(false);
  });

  it('marks completed and fires justCompleted on hitting target', () => {
    const c = challenge({ type: 'ORDER_COUNT', target: 2 });
    const first = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1' }), NOW);
    const second = applyOrderToProgress(c, first.next, order({ id: 'o2' }), NOW);
    expect(second.next.value).toBe(2);
    expect(second.next.completed).toBe(true);
    expect(second.justCompleted).toBe(true);
  });

  it('is idempotent — replaying the same order does not advance', () => {
    const c = challenge({ type: 'ORDER_COUNT', target: 5 });
    const first = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1' }), NOW);
    const replay = applyOrderToProgress(c, first.next, order({ id: 'o1' }), NOW);
    expect(replay.next.value).toBe(1);
  });

  it('does not re-fire justCompleted after completion', () => {
    const c = challenge({ type: 'ORDER_COUNT', target: 1 });
    const first = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1' }), NOW);
    expect(first.justCompleted).toBe(true);
    // Subsequent order — even though it would otherwise advance, the gate
    // short-circuits because `prev.completed` is true.
    const second = applyOrderToProgress(c, first.next, order({ id: 'o2' }), NOW);
    expect(second.justCompleted).toBe(false);
    expect(second.next).toBe(first.next); // identity unchanged
  });
});

// ── SPEND_THRESHOLD ───────────────────────────────────────────────────────

describe('SPEND_THRESHOLD', () => {
  it('sums order totals toward target', () => {
    const c = challenge({ type: 'SPEND_THRESHOLD', target: 1000 });
    const a = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1', total: 300 }), NOW);
    const b = applyOrderToProgress(c, a.next, order({ id: 'o2', total: 500 }), NOW);
    expect(b.next.value).toBe(800);
    expect(b.next.completed).toBe(false);
    const c2 = applyOrderToProgress(c, b.next, order({ id: 'o3', total: 250 }), NOW);
    expect(c2.next.completed).toBe(true);
    expect(c2.justCompleted).toBe(true);
  });

  it('respects minOrderValue gate per order', () => {
    const c = challenge({ type: 'SPEND_THRESHOLD', target: 500, minOrderValue: 200 });
    const a = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1', total: 100 }), NOW);
    expect(a.next.value).toBe(0);   // below min → ignored
    const b = applyOrderToProgress(c, a.next, order({ id: 'o2', total: 250 }), NOW);
    expect(b.next.value).toBe(250);
  });
});

// ── CUISINE_VARIETY ───────────────────────────────────────────────────────

describe('CUISINE_VARIETY', () => {
  it('counts each distinct restaurantId once', () => {
    const c = challenge({ type: 'CUISINE_VARIETY', target: 3 });
    const a = applyOrderToProgress(c, emptyProgress(), order({ id: 'o1', restaurantId: 'r-italia' }), NOW);
    const b = applyOrderToProgress(c, a.next, order({ id: 'o2', restaurantId: 'r-italia' }), NOW);
    expect(b.next.value).toBe(1); // same cuisine → no advance
    const d = applyOrderToProgress(c, b.next, order({ id: 'o3', restaurantId: 'r-biryani' }), NOW);
    expect(d.next.value).toBe(2);
    const e = applyOrderToProgress(c, d.next, order({ id: 'o4', restaurantId: 'r-bbq' }), NOW);
    expect(e.next.value).toBe(3);
    expect(e.next.completed).toBe(true);
    expect(e.justCompleted).toBe(true);
  });
});

// ── WEEKEND_STREAK ────────────────────────────────────────────────────────

describe('WEEKEND_STREAK', () => {
  it('counts only orders placed on Saturday or Sunday', () => {
    const c = challenge({ type: 'WEEKEND_STREAK', target: 3 });
    const weekday = applyOrderToProgress(c, emptyProgress(),
      order({ placedAt: new Date('2026-05-13T13:00:00') }), // Wed
      NOW
    );
    expect(weekday.next.value).toBe(0);
  });

  it('advances on each consecutive weekend', () => {
    const c = challenge({ type: 'WEEKEND_STREAK', target: 2 });
    const sat1 = applyOrderToProgress(c, emptyProgress(),
      order({ id: 'o1', placedAt: new Date('2026-05-09T13:00:00') }), // Sat
      new Date('2026-05-09T13:00:00')
    );
    expect(sat1.next.value).toBe(1);
    const sat2 = applyOrderToProgress(c, sat1.next,
      order({ id: 'o2', placedAt: new Date('2026-05-16T13:00:00') }), // following Sat
      new Date('2026-05-16T13:00:00')
    );
    expect(sat2.next.value).toBe(2);
    expect(sat2.next.completed).toBe(true);
  });

  it('resets the streak on a gap', () => {
    const c = challenge({ type: 'WEEKEND_STREAK', target: 3 });
    const sat1 = applyOrderToProgress(c, emptyProgress(),
      order({ id: 'o1', placedAt: new Date('2026-05-02T13:00:00') }), // Sat
      new Date('2026-05-02T13:00:00')
    );
    // Skip a weekend, then order again three weeks later
    const sat3 = applyOrderToProgress(c, sat1.next,
      order({ id: 'o2', placedAt: new Date('2026-05-23T13:00:00') }), // Sat 3 weeks later
      new Date('2026-05-23T13:00:00')
    );
    expect(sat3.next.value).toBe(1); // streak reset
  });
});

// ── FIRST_N_ORDERS ────────────────────────────────────────────────────────

describe('FIRST_N_ORDERS', () => {
  it('treats first N orders as qualifying regardless of window', () => {
    const c = challenge({ type: 'FIRST_N_ORDERS', target: 5, window: 'LIFETIME' });
    let p = emptyProgress();
    for (let i = 1; i <= 5; i++) {
      const step = applyOrderToProgress(c, p, order({ id: `o${i}`, total: 200 }), NOW);
      p = step.next;
      if (i < 5) expect(step.justCompleted).toBe(false);
      else expect(step.justCompleted).toBe(true);
    }
    expect(p.value).toBe(5);
    expect(p.completed).toBe(true);
  });
});

// ── Percent helper ────────────────────────────────────────────────────────

describe('percentComplete', () => {
  it('returns 0..100 capped at 100', () => {
    const c = challenge({ target: 4 });
    expect(percentComplete(c, 0)).toBe(0);
    expect(percentComplete(c, 2)).toBe(50);
    expect(percentComplete(c, 4)).toBe(100);
    expect(percentComplete(c, 99)).toBe(100); // capped
  });
});
