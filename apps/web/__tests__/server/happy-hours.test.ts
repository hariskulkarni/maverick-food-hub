/**
 * Unit tests for the happy-hour pricing resolver.
 *
 * All cases pin a deterministic `now` so the day/time math is auditable.
 * Day-of-week reference (matches Date.getDay):
 *   0 = Sun · 1 = Mon · 2 = Tue · 3 = Wed · 4 = Thu · 5 = Fri · 6 = Sat
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  isRuleInWindowNow, ruleAppliesToItem, ruleAppliesToCombo,
  priceForItem, priceForCombo, lifecycleBucket,
  minutesUntilHappyHourEnds,
  type HappyHourRuleLite, type ItemLite, type ComboLite
} from '@/server/happy-hours';

// Wed 18:00 — inside a typical 17:00–20:00 happy-hour window.
const WED_6PM = new Date('2026-05-13T18:00:00');
// Wed 14:00 — outside that window.
const WED_2PM = new Date('2026-05-13T14:00:00');
// Sat 12:00 — for weekend-only rules.
const SAT_NOON = new Date('2026-05-16T12:00:00');

// ── Helpers ───────────────────────────────────────────────────────────────

function rule(partial: Partial<HappyHourRuleLite>): HappyHourRuleLite {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 7),
    name: 'Test',
    scope: 'RESTAURANT',
    categoryId: null, menuItemId: null, comboId: null,
    discountType: 'PERCENTAGE',
    percentOff: null, fixedPrice: null, amountOff: null, minPrice: null,
    validFrom: new Date('2025-01-01'),
    validTo: null,
    isActive: true,
    priority: 0,
    // Default schedule covers every weekday evening so most cases work without override.
    schedules: [
      { dayOfWeek: 0, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 1, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 2, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 3, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 4, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 5, startMin: 17 * 60, endMin: 20 * 60 },
      { dayOfWeek: 6, startMin: 17 * 60, endMin: 20 * 60 }
    ],
    ...partial
  };
}

const cocktail: ItemLite = { id: 'item-cocktail', categoryId: 'cat-drinks', price: 400 };
const dessert:  ItemLite = { id: 'item-dessert',  categoryId: 'cat-desserts', price: 200 };
const familyCombo: ComboLite = { id: 'combo-family', price: 1000 };

// ── isRuleInWindowNow ─────────────────────────────────────────────────────

describe('isRuleInWindowNow', () => {
  it('returns true inside a scheduled window', () => {
    expect(isRuleInWindowNow(rule({}), WED_6PM)).toBe(true);
  });

  it('returns false outside the window', () => {
    expect(isRuleInWindowNow(rule({}), WED_2PM)).toBe(false);
  });

  it('returns false when rule is inactive', () => {
    expect(isRuleInWindowNow(rule({ isActive: false }), WED_6PM)).toBe(false);
  });

  it('returns false before validFrom', () => {
    expect(isRuleInWindowNow(rule({ validFrom: new Date('2099-01-01') }), WED_6PM)).toBe(false);
  });

  it('returns false after validTo', () => {
    expect(isRuleInWindowNow(rule({ validTo: new Date('2026-01-01') }), WED_6PM)).toBe(false);
  });

  it('treats no schedule rows as always-in-window within validity range', () => {
    expect(isRuleInWindowNow(rule({ schedules: [] }), WED_2PM)).toBe(true);
  });

  it('weekend-only rule fires Sat noon but not Wed evening', () => {
    const weekendOnly = rule({
      schedules: [
        { dayOfWeek: 0, startMin: 11 * 60, endMin: 22 * 60 },
        { dayOfWeek: 6, startMin: 11 * 60, endMin: 22 * 60 }
      ]
    });
    expect(isRuleInWindowNow(weekendOnly, SAT_NOON)).toBe(true);
    expect(isRuleInWindowNow(weekendOnly, WED_6PM)).toBe(false);
  });
});

// ── Lifecycle bucketing ───────────────────────────────────────────────────

describe('lifecycleBucket', () => {
  it('returns active when current and within validity', () => {
    expect(lifecycleBucket(rule({}), WED_6PM)).toBe('active');
  });
  it('returns upcoming when validFrom is in the future', () => {
    expect(lifecycleBucket(rule({ validFrom: new Date('2099-01-01') }), WED_6PM)).toBe('upcoming');
  });
  it('returns expired when validTo has passed', () => {
    expect(lifecycleBucket(rule({ validTo: new Date('2026-01-01') }), WED_6PM)).toBe('expired');
  });
  it('returns expired when admin toggled off', () => {
    expect(lifecycleBucket(rule({ isActive: false }), WED_6PM)).toBe('expired');
  });
});

// ── Scope tests ───────────────────────────────────────────────────────────

describe('scope predicates', () => {
  it('RESTAURANT rule applies to every item', () => {
    expect(ruleAppliesToItem(rule({ scope: 'RESTAURANT' }), cocktail)).toBe(true);
    expect(ruleAppliesToItem(rule({ scope: 'RESTAURANT' }), dessert)).toBe(true);
  });

  it('CATEGORY rule applies only to matching category', () => {
    const r = rule({ scope: 'CATEGORY', categoryId: 'cat-drinks' });
    expect(ruleAppliesToItem(r, cocktail)).toBe(true);
    expect(ruleAppliesToItem(r, dessert)).toBe(false);
  });

  it('MENU_ITEM rule applies only to the matching item', () => {
    const r = rule({ scope: 'MENU_ITEM', menuItemId: 'item-cocktail' });
    expect(ruleAppliesToItem(r, cocktail)).toBe(true);
    expect(ruleAppliesToItem(r, dessert)).toBe(false);
  });

  it('COMBO rule does not apply to plain menu items', () => {
    const r = rule({ scope: 'COMBO', comboId: 'combo-family' });
    expect(ruleAppliesToItem(r, cocktail)).toBe(false);
    expect(ruleAppliesToCombo(r, familyCombo)).toBe(true);
  });
});

// ── priceForItem — discount type math ────────────────────────────────────

describe('PERCENTAGE discount', () => {
  it('drops a ₹400 item by 25%', () => {
    const p = priceForItem(cocktail, [rule({ percentOff: 25 })], WED_6PM);
    expect(p.effectivePrice).toBe(300);
    expect(p.savings).toBe(100);
    expect(p.rule).not.toBeNull();
  });

  it('respects minPrice floor', () => {
    const p = priceForItem(cocktail, [rule({ percentOff: 90, minPrice: 150 })], WED_6PM);
    // 400 × 10% = 40, floored to 150
    expect(p.effectivePrice).toBe(150);
  });
});

describe('FIXED_PRICE discount', () => {
  it('sets explicit new price', () => {
    const r = rule({ discountType: 'FIXED_PRICE', fixedPrice: 199 });
    const p = priceForItem(cocktail, [r], WED_6PM);
    expect(p.effectivePrice).toBe(199);
    expect(p.savings).toBe(201);
  });

  it('never raises the price above original', () => {
    const r = rule({ discountType: 'FIXED_PRICE', fixedPrice: 9999 });
    const p = priceForItem(cocktail, [r], WED_6PM);
    expect(p.effectivePrice).toBe(400); // clamped back to original
    expect(p.savings).toBe(0);
    expect(p.rule).not.toBeNull(); // a rule did match — it just had no effect
  });
});

describe('FIXED_AMOUNT_OFF discount', () => {
  it('subtracts a flat amount', () => {
    const r = rule({ discountType: 'FIXED_AMOUNT_OFF', amountOff: 50 });
    const p = priceForItem(cocktail, [r], WED_6PM);
    expect(p.effectivePrice).toBe(350);
    expect(p.savings).toBe(50);
  });

  it('clamps at zero so we never go negative', () => {
    const r = rule({ discountType: 'FIXED_AMOUNT_OFF', amountOff: 5000 });
    const p = priceForItem(cocktail, [r], WED_6PM);
    expect(p.effectivePrice).toBe(0);
  });
});

// ── Out-of-window / wrong-scope returns original ─────────────────────────

describe('no-op cases', () => {
  it('returns original price outside the time window', () => {
    const p = priceForItem(cocktail, [rule({ percentOff: 50 })], WED_2PM);
    expect(p.effectivePrice).toBe(400);
    expect(p.rule).toBeNull();
  });

  it('returns original price when no rule applies to the item', () => {
    const drinksOnly = rule({ scope: 'CATEGORY', categoryId: 'cat-drinks', percentOff: 50 });
    const p = priceForItem(dessert, [drinksOnly], WED_6PM);
    expect(p.effectivePrice).toBe(200);
    expect(p.rule).toBeNull();
  });
});

// ── Conflict picking (multiple rules target the same item) ───────────────

describe('conflict picking', () => {
  it('higher priority beats higher savings', () => {
    const bigCheap = rule({ id: 'big',  scope: 'RESTAURANT', percentOff: 50, priority: 0 });
    const smallVIP = rule({ id: 'vip',  scope: 'RESTAURANT', percentOff: 10, priority: 10 });
    const p = priceForItem(cocktail, [bigCheap, smallVIP], WED_6PM);
    expect(p.rule?.id).toBe('vip'); // priority 10 wins
  });

  it('higher savings wins on equal priority', () => {
    const r1 = rule({ id: 'r1', scope: 'RESTAURANT', percentOff: 20 });
    const r2 = rule({ id: 'r2', scope: 'RESTAURANT', percentOff: 30 });
    const p = priceForItem(cocktail, [r1, r2], WED_6PM);
    expect(p.rule?.id).toBe('r2');
  });

  it('specificity breaks ties when priority + savings equal', () => {
    const restaurant10 = rule({ id: 'rest', scope: 'RESTAURANT', percentOff: 10 });
    const drinks10     = rule({ id: 'cat',  scope: 'CATEGORY', categoryId: 'cat-drinks', percentOff: 10 });
    const itemOnly     = rule({ id: 'item', scope: 'MENU_ITEM', menuItemId: 'item-cocktail', percentOff: 10 });
    const p = priceForItem(cocktail, [restaurant10, drinks10, itemOnly], WED_6PM);
    expect(p.rule?.id).toBe('item'); // MENU_ITEM is the most specific
  });

  it('discards rules that are out of window even if higher-priority', () => {
    // Wed 14:00 — the rules below are 17:00–20:00 only
    const onlyEvening = rule({ id: 'eve', percentOff: 50, priority: 100 });
    const allDay = rule({ id: 'all', percentOff: 10, schedules: [] }); // always-on
    const p = priceForItem(cocktail, [onlyEvening, allDay], WED_2PM);
    expect(p.rule?.id).toBe('all');
    expect(p.effectivePrice).toBe(360);
  });
});

// ── priceForCombo ─────────────────────────────────────────────────────────

describe('priceForCombo', () => {
  it('applies a COMBO-scoped rule to the combo only', () => {
    const r = rule({ scope: 'COMBO', comboId: 'combo-family', discountType: 'FIXED_PRICE', fixedPrice: 799 });
    const p = priceForCombo(familyCombo, [r], WED_6PM);
    expect(p.effectivePrice).toBe(799);
    expect(p.savings).toBe(201);
  });

  it('applies a RESTAURANT-scoped rule to the combo too', () => {
    const p = priceForCombo(familyCombo, [rule({ percentOff: 20 })], WED_6PM);
    expect(p.effectivePrice).toBe(800);
  });

  it('ignores a MENU_ITEM-scoped rule even if menuItemId matches the combo id', () => {
    const r = rule({ scope: 'MENU_ITEM', menuItemId: 'combo-family', percentOff: 50 });
    const p = priceForCombo(familyCombo, [r], WED_6PM);
    expect(p.effectivePrice).toBe(1000);
    expect(p.rule).toBeNull();
  });
});

// ── minutesUntilHappyHourEnds ─────────────────────────────────────────────

describe('minutesUntilHappyHourEnds', () => {
  it('returns the soonest window-end across active rules', () => {
    const ending6pm = rule({ schedules: [{ dayOfWeek: 3, startMin: 17 * 60, endMin: 18 * 60 }] });
    const ending8pm = rule({ schedules: [{ dayOfWeek: 3, startMin: 17 * 60, endMin: 20 * 60 }] });
    // Wed 17:30 — ending6pm wraps in 30min, ending8pm in 150min
    const wed_5_30 = new Date('2026-05-13T17:30:00');
    const r = minutesUntilHappyHourEnds([ending6pm, ending8pm], wed_5_30);
    expect(r?.endsInMin).toBe(30);
    expect(r?.endsAt).toBe('18:00');
  });

  it('returns null when no rule is currently active', () => {
    expect(minutesUntilHappyHourEnds([rule({})], WED_2PM)).toBeNull();
  });
});
