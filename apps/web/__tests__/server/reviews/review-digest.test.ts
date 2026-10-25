import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  reviewResponseSettings: { findMany: vi.fn(), updateMany: vi.fn() },
  restaurant: { findUnique: vi.fn() },
}));
const h = vi.hoisted(() => ({ email: vi.fn(), sms: vi.fn(), whatsapp: vi.fn(), phones: vi.fn(), compute: vi.fn(), emails: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/notifications', () => ({ notify: { email: h.email, sms: h.sms, whatsapp: h.whatsapp } }));
vi.mock('@/server/alerts', () => ({ phoneRecipientsForRestaurant: h.phones }));
vi.mock('@/server/reviews/insights', () => ({ computeInsights: h.compute }));
vi.mock('@/server/reviews/review-alerts', () => ({ restaurantEmailRecipients: h.emails }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { formatDigest, sendDigest, runReviewDigest } from '@/server/jobs/review-digest';

const data = {
  periodDays: 7,
  totals: { reviews: 12, average: 4.3, replyRate: 83, medianReplyHours: 5.5, overdue: 2 },
  distribution: { '1': 1, '2': 0, '3': 1, '4': 4, '5': 6 }, weekly: [],
  dishes: [{ name: 'Biryani', mentions: 5, positivePct: 80 }, { name: 'Dosa', mentions: 3, positivePct: 33 }],
  issues: [{ key: 'late', label: 'Late delivery', count: 3 }], staffMentions: [],
  analysis: { analyzed: 12, method: 'keyword' }, google: { average: 4.2, total: 400 },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.restaurant.findUnique.mockResolvedValue({ name: 'Spice Hub' });
  h.compute.mockResolvedValue(data);
  h.emails.mockResolvedValue(['owner@spice.in']);
  h.email.mockResolvedValue({ ok: true });
  h.sms.mockResolvedValue({ ok: true });
  h.whatsapp.mockResolvedValue({ ok: true });
  h.phones.mockResolvedValue(['+919000000001']);
});

describe('formatDigest', () => {
  it('covers rating, count, reply rate/time, praised dishes, issues, overdue', () => {
    const m = formatDigest('Spice Hub', data as any);
    expect(m.text).toContain('Average rating: 4.3');
    expect(m.text).toContain('overall on Google: 4.2 from 400');
    expect(m.text).toContain('New reviews: 12');
    expect(m.text).toContain('Reply rate: 83%; median reply time: 5.5h');
    expect(m.text).toContain('Biryani (5, 80% positive)');
    expect(m.text).not.toContain('Dosa (3'); // not praised
    expect(m.text).toContain('Late delivery (3)');
    expect(m.text).toContain('Overdue replies: 2');
    expect(m.short.length).toBeLessThan(200);
  });
});

describe('sendDigest', () => {
  it('emails owners/admins the last 7 days and adds SMS/WhatsApp when asked', async () => {
    const out = await sendDigest('rest1', { channels: { sms: true, whatsapp: false } });
    expect(h.compute).toHaveBeenCalledWith('rest1', expect.objectContaining({ days: 7 }));
    expect(h.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@spice.in', template: 'reviews.weekly_digest' }));
    expect(h.sms).toHaveBeenCalledWith(expect.objectContaining({ to: '+919000000001' }));
    expect(h.whatsapp).not.toHaveBeenCalled();
    expect(out).toEqual({ recipients: 1, sent: 1 });
  });
});

describe('runReviewDigest', () => {
  it('claims each enabled restaurant once per ~week and skips already-sent ones', async () => {
    db.reviewResponseSettings.findMany.mockResolvedValue([
      { restaurantId: 'r1', digestSms: false, digestWhatsapp: false },
      { restaurantId: 'r2', digestSms: false, digestWhatsapp: false },
    ]);
    db.reviewResponseSettings.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const now = new Date('2026-10-26T03:30:00Z');
    const r = await runReviewDigest(now);
    expect(r).toEqual({ restaurants: 2, sent: 1, skipped: 1, failed: 0 });
    expect(db.reviewResponseSettings.findMany.mock.calls[0][0].where).toEqual({ digestEnabled: true });
    const claim = db.reviewResponseSettings.updateMany.mock.calls[0][0];
    expect(claim.where.OR[1].digestLastSentAt.lt).toEqual(new Date(now.getTime() - 6 * 86_400_000));
    expect(claim.data).toEqual({ digestLastSentAt: now });
  });
  it('a failing restaurant does not stop the run', async () => {
    db.reviewResponseSettings.findMany.mockResolvedValue([{ restaurantId: 'r1' }, { restaurantId: 'r2' }]);
    db.reviewResponseSettings.updateMany.mockResolvedValue({ count: 1 });
    h.compute.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(data);
    const r = await runReviewDigest();
    expect(r).toMatchObject({ sent: 1, failed: 1 });
  });
});
