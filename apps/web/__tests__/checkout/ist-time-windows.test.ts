import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Customer audit P1-14: schedules are IST wall-clock; evaluation must not depend on the server TZ.
const prevTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = prevTz; });

import { istClock, istDayAt } from '@/lib/ist-time';
import { isBranchOpenAt } from '@/server/operating-hours';
import { isCategoryAvailableNow } from '@/server/category-availability';
import { isRuleInWindowNow } from '@/server/happy-hours';
import { evaluateOffer } from '@/server/offers';

// 2026-10-25 is a Sunday. 06:30Z = 12:00 IST Sunday; 20:00Z = 01:30 IST Monday.
const noonIstSunday = new Date('2026-10-25T06:30:00Z');
const lateIstMonday = new Date('2026-10-25T20:00:00Z');

describe('IST helpers', () => {
  it('clock is IST regardless of process TZ', () => {
    expect(istClock(noonIstSunday)).toEqual({ dayOfWeek: 0, minutes: 720 });
    expect(istClock(lateIstMonday)).toEqual({ dayOfWeek: 1, minutes: 90 });
    expect(istDayAt(noonIstSunday, 1, 11 * 60).toISOString()).toBe('2026-10-26T05:30:00.000Z');
  });
});

describe('time windows evaluate in IST', () => {
  it('operating hours', () => {
    const rows = [{ dayOfWeek: 0, openMin: 11 * 60, closeMin: 15 * 60 }, { dayOfWeek: 1, openMin: 11 * 60, closeMin: 15 * 60 }];
    expect(isBranchOpenAt(rows, noonIstSunday).isOpen).toBe(true);
    const closed = isBranchOpenAt(rows, lateIstMonday);
    expect(closed.isOpen).toBe(false);
    expect(closed.nextChangeAt?.toISOString()).toBe('2026-10-26T05:30:00.000Z'); // Monday 11:00 IST
  });
  it('category schedule', () => {
    const cat = { id: 'c', name: 'Lunch', isActive: true, scheduleEnabled: true, availabilities: [{ dayOfWeek: 0, startMin: 660, endMin: 900 }] };
    expect(isCategoryAvailableNow(cat as any, noonIstSunday).available).toBe(true);
  });
  it('happy hour', () => {
    const rule = { isActive: true, validFrom: new Date(0), validTo: null, schedules: [{ dayOfWeek: 0, startMin: 660, endMin: 780 }] };
    expect(isRuleInWindowNow(rule as any, noonIstSunday)).toBe(true);
  });
  it('offer window', () => {
    const offer = {
      id: 'o', name: 'Lunch deal', type: 'FIXED', code: null, percentOff: null, flatOff: 10, maxDiscount: null, minOrderAmount: null,
      rewardConfig: null, restaurantId: null, branchId: null, issuedChannel: 'ANY', redeemChannel: 'ANY', minCustomerOrders: 0,
      validFrom: new Date(0), validTo: null, usageLimit: null, usedCount: 0, perUserLimit: 5, isActive: true, priority: 0,
      autoApply: true, stackable: false, schedules: [{ dayOfWeek: 0, startMin: 660, endMin: 780 }],
    };
    const ctx = { cart: [{ menuItemId: 'm', unitPrice: 100, quantity: 1 }], subtotal: 100, channel: 'ONLINE' as const, branchId: null, restaurantId: null, customerOrderCount: 0, now: noonIstSunday };
    expect(evaluateOffer(offer as any, ctx).eligible).toBe(true);
  });
});
