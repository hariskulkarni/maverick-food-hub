import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  istHour, isQuietHour, isStale, computeDueAt, reminderDueAt, pickChannel, buildGoogleReviewUrl,
  buildAskMessage, effectiveRating, needsRecovery, isValidToken, newToken, writeReviewUrl,
} from '@/server/reviews/acquisition';

// 2026-10-24T15:30Z = 21:00 IST
const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 24, h, m) - 330 * 60_000);

describe('quiet hours (IST)', () => {
  it('converts UTC to IST hour', () => {
    expect(istHour(new Date('2026-10-24T15:30:00Z'))).toBe(21);
    expect(istHour(new Date('2026-10-24T18:29:00Z'))).toBe(23);
    expect(istHour(new Date('2026-10-24T18:30:00Z'))).toBe(0);
  });
  it('wraps midnight for 21 → 9', () => {
    expect(isQuietHour(ist(21), 21, 9)).toBe(true);
    expect(isQuietHour(ist(2), 21, 9)).toBe(true);
    expect(isQuietHour(ist(8, 59), 21, 9)).toBe(true);
    expect(isQuietHour(ist(9), 21, 9)).toBe(false);
    expect(isQuietHour(ist(20, 59), 21, 9)).toBe(false);
  });
  it('handles a same-day window and disabled bounds', () => {
    expect(isQuietHour(ist(14), 13, 16)).toBe(true);
    expect(isQuietHour(ist(16), 13, 16)).toBe(false);
    expect(isQuietHour(ist(2), null, null)).toBe(false);
    expect(isQuietHour(ist(2), 5, 5)).toBe(false);
  });
});

describe('scheduling', () => {
  it('due = delivered + delay; reminder only when enabled', () => {
    const d = new Date('2026-10-24T10:00:00Z');
    expect(computeDueAt(d, 90).toISOString()).toBe('2026-10-24T11:30:00.000Z');
    expect(computeDueAt(d, -5).getTime()).toBe(d.getTime());
    expect(reminderDueAt(d, { reminderEnabled: false, reminderAfterHours: 24 })).toBeNull();
    expect(reminderDueAt(d, { reminderEnabled: true, reminderAfterHours: 24 })!.toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });
  it('drops asks older than 72h instead of sending them late', () => {
    const now = new Date('2026-10-24T10:00:00Z');
    expect(isStale(new Date('2026-10-21T09:59:00Z'), now)).toBe(true);
    expect(isStale(new Date('2026-10-21T10:01:00Z'), now)).toBe(false);
  });
});

describe('channel selection', () => {
  it('uses the first reachable channel in priority order', () => {
    expect(pickChannel(['SMS', 'EMAIL'], { phone: '+91', email: 'a@b.c' }, false)).toBe('SMS');
    expect(pickChannel(['EMAIL', 'SMS'], { phone: '+91', email: null }, false)).toBe('SMS');
    expect(pickChannel(['EMAIL'], { phone: '+91' }, false)).toBeNull();
  });
  it('skips WhatsApp without an approved template / credentials', () => {
    expect(pickChannel(['WHATSAPP', 'SMS'], { phone: '+91' }, false)).toBe('SMS');
    expect(pickChannel(['WHATSAPP', 'SMS'], { phone: '+91' }, true)).toBe('WHATSAPP');
  });
});

describe('Google review link', () => {
  it('override > GBP review url > GBP place id > Places place id', () => {
    expect(buildGoogleReviewUrl({ override: 'https://x/o', gbpReviewUrl: 'https://g', placesPlaceId: 'P' })).toEqual({ url: 'https://x/o', source: 'override' });
    expect(buildGoogleReviewUrl({ gbpReviewUrl: 'https://g', gbpPlaceId: 'G' })).toEqual({ url: 'https://g', source: 'gbp' });
    expect(buildGoogleReviewUrl({ gbpPlaceId: 'G', placesPlaceId: 'P' })).toEqual({ url: writeReviewUrl('G'), source: 'gbp' });
    expect(buildGoogleReviewUrl({ placesPlaceId: 'P' })).toEqual({ url: 'https://search.google.com/local/writereview?placeid=P', source: 'places' });
    expect(buildGoogleReviewUrl({})).toEqual({ url: null, source: null });
  });
});

describe('ask copy', () => {
  const m = buildAskMessage({ kind: 'ask', restaurantName: 'Spice Hub', orderCode: 'ORD-AB12', link: 'https://f/rv/t', stop: 'https://f/rv/t/stop' });
  it('is order-specific and always carries the tracked + STOP links', () => {
    for (const s of [m.sms, m.text, m.html]) {
      expect(s).toContain('ORD-AB12');
      expect(s).toContain('https://f/rv/t');
      expect(s).toContain('https://f/rv/t/stop');
    }
  });
  it('contains no incentive or promo wording', () => {
    for (const s of [m.sms, m.text, m.html, m.subject]) {
      expect(s).not.toMatch(/discount|off\b|coupon|reward|points|free|offer|win|cashback/i);
    }
  });
  it('reminder copy says so', () => {
    expect(buildAskMessage({ kind: 'reminder', restaurantName: 'R', orderCode: 'C', link: 'l', stop: 's' }).sms).toMatch(/reminder/i);
  });
});

describe('recovery rating', () => {
  it('uses overall, else the worst axis', () => {
    expect(effectiveRating({ overallRating: 4, foodRating: 1 })).toBe(4);
    expect(effectiveRating({ foodRating: 5, deliveryRating: 2 })).toBe(2);
    expect(effectiveRating({})).toBeNull();
  });
  it('opens recovery at or below the threshold only', () => {
    expect(needsRecovery(3, 3)).toBe(true);
    expect(needsRecovery(4, 3)).toBe(false);
    expect(needsRecovery(null, 3)).toBe(false);
  });
});

describe('tokens', () => {
  it('mints unguessable url-safe tokens that pass validation', () => {
    const t = newToken();
    expect(t).toHaveLength(24);
    expect(isValidToken(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(isValidToken('../etc/passwd')).toBe(false);
    expect(isValidToken('short')).toBe(false);
  });
});
