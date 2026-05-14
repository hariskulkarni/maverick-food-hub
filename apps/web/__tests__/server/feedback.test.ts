/**
 * Pure-resolver tests for the post-delivery feedback engine.
 *
 * Three behaviours we cannot let drift:
 *   1. The 48-hour window. Submission AND edit both honour the same ceiling.
 *   2. Role-based redaction. Riders must NEVER see private comments unless
 *      the customer opted in, and must NEVER see food-quality content.
 *   3. The summary math used by every reports page.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  FEEDBACK_WINDOW_HOURS, FEEDBACK_WINDOW_MS,
  windowEndForOrder,
  canSubmitFeedback, canEditFeedback, isFeedbackReadOnly,
  visibleForRole, summariseRatings,
  type OrderLite, type FeedbackLite
} from '@/server/feedback';

const NOW = new Date('2026-05-13T13:00:00');
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 3600_000);
const FIFTY_HOURS_AGO = new Date(NOW.getTime() - 50 * 3600_000);

// ── Fixtures ─────────────────────────────────────────────────────────────

function order(partial: Partial<OrderLite> = {}): OrderLite {
  return {
    id: 'o1',
    customerId: 'c1',
    status: 'DELIVERED',
    deliveredAt: TWO_HOURS_AGO,
    ...partial
  };
}

function fb(partial: Partial<FeedbackLite> = {}): FeedbackLite {
  return {
    id: 'fb1',
    orderId: 'o1',
    customerId: 'c1',
    foodRating: 4,
    deliveryRating: 5,
    overallRating: 4,
    comment: 'Loved it',
    issueTags: [],
    imageUrl: null,
    shareCommentWithRider: false,
    windowEndsAt: new Date(NOW.getTime() + 10 * 3600_000),
    createdAt: TWO_HOURS_AGO,
    editedAt: null,
    ...partial
  };
}

// ── Constants ────────────────────────────────────────────────────────────

describe('constants', () => {
  it('48-hour window is 172_800_000ms', () => {
    expect(FEEDBACK_WINDOW_HOURS).toBe(48);
    expect(FEEDBACK_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });
});

// ── windowEndForOrder ────────────────────────────────────────────────────

describe('windowEndForOrder', () => {
  it('returns deliveredAt + 48h when delivered', () => {
    const end = windowEndForOrder(order())!;
    expect(end.getTime() - TWO_HOURS_AGO.getTime()).toBe(FEEDBACK_WINDOW_MS);
  });
  it('returns null when never delivered', () => {
    expect(windowEndForOrder(order({ deliveredAt: null }))).toBeNull();
  });
});

// ── canSubmitFeedback ────────────────────────────────────────────────────

describe('canSubmitFeedback', () => {
  it('approves a delivered order from the owning customer within window', () => {
    expect(canSubmitFeedback(order(), null, 'c1', NOW)).toEqual({ eligible: true });
  });
  it('rejects when the order is not delivered', () => {
    expect(canSubmitFeedback(order({ status: 'OUT_FOR_DELIVERY' }), null, 'c1', NOW)).toMatchObject({ eligible: false, reason: 'not_delivered' });
  });
  it('rejects when the caller is not the order owner', () => {
    expect(canSubmitFeedback(order(), null, 'someone-else', NOW)).toMatchObject({ eligible: false, reason: 'not_owner' });
  });
  it('rejects when feedback already exists', () => {
    expect(canSubmitFeedback(order(), fb(), 'c1', NOW)).toMatchObject({ eligible: false, reason: 'already_submitted' });
  });
  it('rejects past the 48h window', () => {
    expect(canSubmitFeedback(order({ deliveredAt: FIFTY_HOURS_AGO }), null, 'c1', NOW)).toMatchObject({ eligible: false, reason: 'window_expired' });
  });
});

// ── canEditFeedback ──────────────────────────────────────────────────────

describe('canEditFeedback', () => {
  it('allows the author within the window', () => {
    expect(canEditFeedback(fb(), 'c1', NOW)).toEqual({ eligible: true });
  });
  it('rejects non-author edits', () => {
    expect(canEditFeedback(fb(), 'c2', NOW)).toMatchObject({ eligible: false, reason: 'not_owner' });
  });
  it('rejects past the window', () => {
    const expired = fb({ windowEndsAt: new Date(NOW.getTime() - 60_000) });
    expect(canEditFeedback(expired, 'c1', NOW)).toMatchObject({ eligible: false, reason: 'window_expired' });
  });
  it('rejects when no feedback exists', () => {
    expect(canEditFeedback(null, 'c1', NOW)).toMatchObject({ eligible: false, reason: 'already_submitted' });
  });
});

describe('isFeedbackReadOnly', () => {
  it('false within window', () => {
    expect(isFeedbackReadOnly(fb(), NOW)).toBe(false);
  });
  it('true past window', () => {
    expect(isFeedbackReadOnly(fb({ windowEndsAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(true);
  });
});

// ── visibleForRole ───────────────────────────────────────────────────────

describe('visibleForRole — CUSTOMER and SUPER_ADMIN see everything', () => {
  it('all fields visible', () => {
    for (const role of ['CUSTOMER', 'SUPER_ADMIN'] as const) {
      const v = visibleForRole(fb({ comment: 'great', imageUrl: 'http://x/i.jpg', issueTags: ['LATE_DELIVERY' as any] }), role);
      expect(v.foodRating).toBe(4);
      expect(v.deliveryRating).toBe(5);
      expect(v.overallRating).toBe(4);
      expect(v.comment).toBe('great');
      expect(v.imageUrl).toBe('http://x/i.jpg');
      expect(v.issueTags).toEqual(['LATE_DELIVERY']);
      expect(v.visibleFields).toEqual(['food', 'delivery', 'overall', 'comment', 'tags', 'image']);
    }
  });
});

describe('visibleForRole — ADMIN sees food side but not delivery rating', () => {
  it('redacts deliveryRating and keeps food-related tags only', () => {
    const f = fb({ comment: 'cold food', imageUrl: 'http://x/i.jpg', issueTags: ['LATE_DELIVERY' as any, 'COLD_FOOD' as any] });
    const v = visibleForRole(f, 'ADMIN');
    expect(v.deliveryRating).toBeNull();
    expect(v.foodRating).toBe(4);
    expect(v.overallRating).toBe(4);
    expect(v.comment).toBe('cold food');
    expect(v.imageUrl).toBe('http://x/i.jpg');
    expect(v.issueTags).toEqual(['COLD_FOOD']);   // LATE_DELIVERY dropped
    expect(v.visibleFields).toContain('food');
    expect(v.visibleFields).not.toContain('delivery');
  });
});

describe('visibleForRole — KITCHEN sees only food rating + food tags', () => {
  it('no comment, no image, no delivery info', () => {
    const f = fb({ comment: 'cold food', imageUrl: 'http://x/i.jpg', issueTags: ['COLD_FOOD' as any] });
    const v = visibleForRole(f, 'KITCHEN');
    expect(v.foodRating).toBe(4);
    expect(v.deliveryRating).toBeNull();
    expect(v.overallRating).toBeNull();
    expect(v.comment).toBeNull();
    expect(v.imageUrl).toBeNull();
    expect(v.issueTags).toEqual(['COLD_FOOD']);
    expect(v.visibleFields).toEqual(['food', 'tags']);
  });
});

describe('visibleForRole — RIDER protections', () => {
  it('default: delivery rating + delivery-side tags only, no comment, no image', () => {
    const f = fb({
      comment: 'rider was rude',
      imageUrl: 'http://x/i.jpg',
      issueTags: ['LATE_DELIVERY' as any, 'RIDER_BEHAVIOR' as any],
      shareCommentWithRider: false
    });
    const v = visibleForRole(f, 'RIDER');
    expect(v.foodRating).toBeNull();
    expect(v.deliveryRating).toBe(5);
    expect(v.overallRating).toBeNull();
    expect(v.comment).toBeNull();
    expect(v.issueTags.sort()).toEqual(['LATE_DELIVERY', 'RIDER_BEHAVIOR']);
    // No image because no food-side complaints — actually correct! Image hides
    // only when food tags ARE present (food-quality photo). Here we have
    // delivery-only tags, so the image IS shown.
    expect(v.imageUrl).toBe('http://x/i.jpg');
  });

  it('comment surfaces only when customer opted in', () => {
    const f = fb({ comment: 'thanks!', shareCommentWithRider: true, issueTags: [] });
    const v = visibleForRole(f, 'RIDER');
    expect(v.comment).toBe('thanks!');
  });

  it('image is hidden when any food-side tag is present (food-photo privacy)', () => {
    const f = fb({ imageUrl: 'http://x/i.jpg', issueTags: ['COLD_FOOD' as any] });
    const v = visibleForRole(f, 'RIDER');
    expect(v.imageUrl).toBeNull();
  });

  it('drops food-side tags entirely', () => {
    const f = fb({ issueTags: ['COLD_FOOD' as any, 'LATE_DELIVERY' as any] });
    const v = visibleForRole(f, 'RIDER');
    expect(v.issueTags).toEqual(['LATE_DELIVERY']);
  });
});

// ── summariseRatings ─────────────────────────────────────────────────────

describe('summariseRatings', () => {
  it('computes averages rounded to 1dp, ignoring nulls', () => {
    const s = summariseRatings([
      fb({ foodRating: 5, deliveryRating: 4, overallRating: 5 }),
      fb({ foodRating: 4, deliveryRating: 5, overallRating: 5 }),
      fb({ foodRating: null, deliveryRating: 3, overallRating: 4 })
    ]);
    expect(s.count).toBe(3);
    expect(s.avgFood).toBe(4.5);    // (5+4)/2
    expect(s.avgDelivery).toBe(4);  // (4+5+3)/3
    expect(s.avgOverall).toBeCloseTo(4.7, 1); // (5+5+4)/3
  });

  it('returns null avgs when no data on that axis', () => {
    const s = summariseRatings([fb({ foodRating: null, deliveryRating: null, overallRating: null })]);
    expect(s.avgFood).toBeNull();
    expect(s.avgDelivery).toBeNull();
    expect(s.avgOverall).toBeNull();
  });

  it('counts low ratings (≤2) per axis', () => {
    const s = summariseRatings([
      fb({ foodRating: 1, deliveryRating: 2, overallRating: 5 }),
      fb({ foodRating: 5, deliveryRating: 5, overallRating: 1 })
    ]);
    expect(s.lowFoodCount).toBe(1);
    expect(s.lowDeliveryCount).toBe(1);
    expect(s.lowOverallCount).toBe(1);
  });

  it('counts each issue tag occurrence across rows', () => {
    const s = summariseRatings([
      fb({ issueTags: ['LATE_DELIVERY' as any, 'COLD_FOOD' as any] }),
      fb({ issueTags: ['LATE_DELIVERY' as any] }),
      fb({ issueTags: [] })
    ]);
    expect(s.tagCounts['LATE_DELIVERY']).toBe(2);
    expect(s.tagCounts['COLD_FOOD']).toBe(1);
    expect(s.tagCounts['MISSING_ITEM']).toBeUndefined();
  });

  it('returns zero-everything on empty input', () => {
    const s = summariseRatings([]);
    expect(s.count).toBe(0);
    expect(s.avgFood).toBeNull();
    expect(s.tagCounts).toEqual({});
  });
});
