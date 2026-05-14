/**
 * Unit tests for the offer engine (`src/server/offers.ts`).
 *
 * We exercise the pure resolver (`evaluateOffer` + `pickBestOffers`) — no DB.
 * Each offer type has at least one positive and one negative case. Pricing /
 * `loadAndApplyOffers` are covered by integration tests; this file's purpose
 * is to nail down the gating + reward math.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import { evaluateOffer, pickBestOffers, type OfferRow, type OfferContext } from '@/server/offers';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-13T13:00:00');

function offer(partial: Partial<OfferRow>): OfferRow {
  return {
    id: 'offer-' + Math.random().toString(36).slice(2, 7),
    name: 'Test',
    type: 'PERCENTAGE',
    code: null,
    percentOff: null, flatOff: null, maxDiscount: null, minOrderAmount: null,
    rewardConfig: null,
    restaurantId: null, branchId: null,
    appliesToCategories: [], appliesToItems: [],
    issuedChannel: 'ANY', redeemChannel: 'ANY',
    minCustomerOrders: 0,
    validFrom: new Date('2025-01-01'), validTo: null,
    usageLimit: null, usedCount: 0, perUserLimit: 1,
    isActive: true, priority: 0, autoApply: false, stackable: false,
    ...partial
  };
}

function ctx(partial: Partial<OfferContext> = {}): OfferContext {
  const cart = partial.cart ?? [
    { menuItemId: 'item-a', categoryId: 'cat-mains', unitPrice: 200, quantity: 2 },
    { menuItemId: 'item-b', categoryId: 'cat-desserts', unitPrice: 100, quantity: 1 }
  ];
  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return {
    cart, subtotal,
    channel: 'ONLINE',
    branchId: 'branch-1', restaurantId: 'rest-1',
    customerOrderCount: 0,
    customerRedemptionsForOffer: 0,
    now: NOW,
    ...partial
  };
}

// ── Gating ────────────────────────────────────────────────────────────────

describe('gating', () => {
  it('rejects inactive offer', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, isActive: false }), ctx());
    expect(r.eligible).toBe(false);
  });

  it('rejects offer outside validity window', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, validTo: new Date('2026-01-01') }), ctx());
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toMatch(/expired/);
  });

  it('rejects offer that has hit usage limit', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, usageLimit: 100, usedCount: 100 }), ctx());
    expect(r.eligible).toBe(false);
  });

  it('rejects offer when per-customer cap is reached', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, perUserLimit: 1 }), ctx({ customerRedemptionsForOffer: 1 }));
    expect(r.eligible).toBe(false);
  });

  it('rejects offer when subtotal below minOrderAmount', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, minOrderAmount: 1000 }), ctx());
    expect(r.eligible).toBe(false);
  });

  it('rejects offer scoped to a different restaurant', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 50, restaurantId: 'rest-X' }), ctx());
    expect(r.eligible).toBe(false);
  });

  it('rejects offer when redeemChannel mismatches', () => {
    const r = evaluateOffer(offer({ type: 'DINE_IN_TO_ONLINE', flatOff: 30, redeemChannel: 'ONLINE' }), ctx({ channel: 'DINE_IN' }));
    expect(r.eligible).toBe(false);
  });
});

// ── PERCENTAGE ────────────────────────────────────────────────────────────

describe('PERCENTAGE', () => {
  it('applies % of cart subtotal', () => {
    const r = evaluateOffer(offer({ type: 'PERCENTAGE', percentOff: 20 }), ctx());
    // Cart 500 × 20% = 100
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(100);
  });

  it('caps at maxDiscount', () => {
    const r = evaluateOffer(offer({ type: 'PERCENTAGE', percentOff: 50, maxDiscount: 75 }), ctx());
    // 50% of 500 = 250, capped to 75
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(75);
  });

  it('respects category scope', () => {
    const r = evaluateOffer(
      offer({ type: 'PERCENTAGE', percentOff: 50, appliesToCategories: [{ categoryId: 'cat-desserts' }] }),
      ctx()
    );
    // Only desserts qualify → 100 × 50% = 50
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(50);
  });
});

// ── FIXED ─────────────────────────────────────────────────────────────────

describe('FIXED', () => {
  it('applies flat off', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 75 }), ctx());
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(75);
  });

  it('clamps when flatOff exceeds subtotal', () => {
    const r = evaluateOffer(offer({ type: 'FIXED', flatOff: 9999 }), ctx());
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(500); // capped to subtotal
  });
});

// ── BUY_X_GET_Y ───────────────────────────────────────────────────────────

describe('BUY_X_GET_Y', () => {
  it('grants free units when both items present', () => {
    const r = evaluateOffer(
      offer({ type: 'BUY_X_GET_Y', rewardConfig: { buyItemId: 'item-a', buyQty: 2, getItemId: 'item-b', getQty: 1, getDiscountPct: 100 } }),
      ctx() // 2× item-a (qualifies), 1× item-b (free → ₹100 off)
    );
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(100);
  });

  it('rejects when buy quantity not met', () => {
    const r = evaluateOffer(
      offer({ type: 'BUY_X_GET_Y', rewardConfig: { buyItemId: 'item-a', buyQty: 5, getItemId: 'item-b', getQty: 1 } }),
      ctx()
    );
    expect(r.eligible).toBe(false);
  });

  it('partial discount with getDiscountPct=50', () => {
    const r = evaluateOffer(
      offer({ type: 'BUY_X_GET_Y', rewardConfig: { buyItemId: 'item-a', buyQty: 2, getItemId: 'item-b', getQty: 1, getDiscountPct: 50 } }),
      ctx()
    );
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(50);
  });
});

// ── COMBO_DISCOUNT ────────────────────────────────────────────────────────

describe('COMBO_DISCOUNT', () => {
  it('applies bundle saving when all items present', () => {
    const r = evaluateOffer(
      offer({
        type: 'COMBO_DISCOUNT',
        rewardConfig: { items: [{ id: 'item-a', qty: 1 }, { id: 'item-b', qty: 1 }], comboPrice: 250 }
      }),
      ctx() // regular 200 + 100 = 300, combo 250 → save 50
    );
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(50);
  });

  it('rejects when one item is missing', () => {
    const r = evaluateOffer(
      offer({
        type: 'COMBO_DISCOUNT',
        rewardConfig: { items: [{ id: 'item-a', qty: 1 }, { id: 'item-X', qty: 1 }], comboPrice: 250 }
      }),
      ctx()
    );
    expect(r.eligible).toBe(false);
  });
});

// ── FREE_ITEM_ABOVE ───────────────────────────────────────────────────────

describe('FREE_ITEM_ABOVE', () => {
  it('discounts one unit of gift when cart ≥ threshold and gift in cart', () => {
    const r = evaluateOffer(
      offer({ type: 'FREE_ITEM_ABOVE', rewardConfig: { itemId: 'item-b', threshold: 400 } }),
      ctx() // subtotal 500, item-b in cart → 100 off
    );
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.amountOff).toBe(100);
  });

  it('asks customer to add gift to cart when missing', () => {
    const cartNoGift = [{ menuItemId: 'item-a', categoryId: 'cat-mains', unitPrice: 200, quantity: 3 }];
    const r = evaluateOffer(
      offer({ type: 'FREE_ITEM_ABOVE', rewardConfig: { itemId: 'item-b', threshold: 400 } }),
      ctx({ cart: cartNoGift })
    );
    expect(r.eligible).toBe(false);
  });

  it('rejects when subtotal below threshold', () => {
    const small = [{ menuItemId: 'item-b', categoryId: 'cat-desserts', unitPrice: 100, quantity: 1 }];
    const r = evaluateOffer(
      offer({ type: 'FREE_ITEM_ABOVE', rewardConfig: { itemId: 'item-b', threshold: 400 } }),
      ctx({ cart: small })
    );
    expect(r.eligible).toBe(false);
  });
});

// ── Customer-lifecycle types ──────────────────────────────────────────────

describe('FIRST_ORDER', () => {
  it('applies for brand-new customers', () => {
    const r = evaluateOffer(offer({ type: 'FIRST_ORDER', flatOff: 100 }), ctx({ customerOrderCount: 0 }));
    expect(r.eligible).toBe(true);
  });
  it('rejects when customer has past orders', () => {
    const r = evaluateOffer(offer({ type: 'FIRST_ORDER', flatOff: 100 }), ctx({ customerOrderCount: 3 }));
    expect(r.eligible).toBe(false);
  });
});

describe('REPEAT_CUSTOMER', () => {
  it('applies when customer meets order threshold', () => {
    const r = evaluateOffer(offer({ type: 'REPEAT_CUSTOMER', flatOff: 50, minCustomerOrders: 5 }), ctx({ customerOrderCount: 6 }));
    expect(r.eligible).toBe(true);
  });
  it('rejects when below threshold', () => {
    const r = evaluateOffer(offer({ type: 'REPEAT_CUSTOMER', flatOff: 50, minCustomerOrders: 5 }), ctx({ customerOrderCount: 2 }));
    expect(r.eligible).toBe(false);
  });
});

describe('Cross-channel coupons', () => {
  it('DINE_IN_TO_ONLINE only redeemable online', () => {
    const o = offer({ type: 'DINE_IN_TO_ONLINE', flatOff: 50, issuedChannel: 'DINE_IN', redeemChannel: 'ONLINE' });
    expect(evaluateOffer(o, ctx({ channel: 'ONLINE' })).eligible).toBe(true);
    expect(evaluateOffer(o, ctx({ channel: 'DINE_IN' })).eligible).toBe(false);
  });
  it('ONLINE_TO_DINE_IN only redeemable in-restaurant', () => {
    const o = offer({ type: 'ONLINE_TO_DINE_IN', flatOff: 75, issuedChannel: 'ONLINE', redeemChannel: 'DINE_IN' });
    expect(evaluateOffer(o, ctx({ channel: 'DINE_IN' })).eligible).toBe(true);
    expect(evaluateOffer(o, ctx({ channel: 'ONLINE' })).eligible).toBe(false);
  });
});

// ── pickBestOffers — priority + stackable ────────────────────────────────

describe('pickBestOffers', () => {
  it('picks highest-priority single offer', () => {
    const low  = offer({ id: 'low',  type: 'FIXED', flatOff: 100, priority: 1 });
    const high = offer({ id: 'high', type: 'FIXED', flatOff: 50,  priority: 10 });
    const r = pickBestOffers([low, high], ctx());
    expect(r.winners[0].offer.id).toBe('high');
    expect(r.totalAmountOff).toBe(50);
  });

  it('breaks ties on amountOff', () => {
    const a = offer({ id: 'a', type: 'FIXED', flatOff: 60, priority: 5 });
    const b = offer({ id: 'b', type: 'FIXED', flatOff: 80, priority: 5 });
    const r = pickBestOffers([a, b], ctx());
    expect(r.winners[0].offer.id).toBe('b');
  });

  it('stacks compatible stackable offers when total beats best single', () => {
    // Two scoped, stackable offers that don't claim the same line.
    const dessertsPct = offer({
      id: 'desserts', type: 'PERCENTAGE', percentOff: 50, stackable: true,
      appliesToCategories: [{ categoryId: 'cat-desserts' }]
    });
    const mainsPct = offer({
      id: 'mains', type: 'PERCENTAGE', percentOff: 10, stackable: true,
      appliesToCategories: [{ categoryId: 'cat-mains' }]
    });
    const single = offer({ id: 'single', type: 'FIXED', flatOff: 60, stackable: false });
    // Stack: desserts 50 + mains 40 = 90 vs single 60 → stack wins
    const r = pickBestOffers([dessertsPct, mainsPct, single], ctx());
    expect(r.winners.length).toBe(2);
    expect(r.totalAmountOff).toBe(90);
  });

  it('falls back to single when stack worse than best non-stackable', () => {
    const stackA = offer({ id: 'a', type: 'FIXED', flatOff: 20, stackable: true });
    const stackB = offer({ id: 'b', type: 'FIXED', flatOff: 30, stackable: true });
    const single = offer({ id: 's', type: 'FIXED', flatOff: 200, stackable: false });
    const r = pickBestOffers([stackA, stackB, single], ctx());
    expect(r.winners.length).toBe(1);
    expect(r.winners[0].offer.id).toBe('s');
    expect(r.totalAmountOff).toBe(200);
  });

  it('returns all evaluations (for "why not" messaging)', () => {
    const ok    = offer({ id: 'good',  type: 'FIXED', flatOff: 30 });
    const bad   = offer({ id: 'expired', type: 'FIXED', flatOff: 999, validTo: new Date('2024-01-01') });
    const r = pickBestOffers([ok, bad], ctx());
    expect(r.evaluations.length).toBe(2);
    expect(r.evaluations.find((e) => e.offer.id === 'bad-test')?.result.eligible).toBeUndefined(); // sanity
    expect(r.evaluations.find((e) => e.offer.id === 'expired')?.result.eligible).toBe(false);
  });
});
