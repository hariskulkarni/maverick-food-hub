import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  reviewResponseSettings: { findUnique: vi.fn(), findMany: vi.fn() },
  googleReview: { updateMany: vi.fn(), findMany: vi.fn() },
  restaurant: { findUnique: vi.fn() },
}));
const n = vi.hoisted(() => ({ email: vi.fn(), sms: vi.fn(), whatsapp: vi.fn(), phones: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/notifications', () => ({ notify: { email: n.email, sms: n.sms, whatsapp: n.whatsapp } }));
vi.mock('@/server/alerts', () => ({ phoneRecipientsForRestaurant: n.phones }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendNegativeReviewAlerts, runSlaEscalations, formatNegativeAlert, restaurantEmailRecipients, reviewLink } from '@/server/reviews/review-alerts';

const now = new Date('2026-10-24T10:00:00Z');
const bad = { id: 'g1', rating: 1, reviewerName: 'Asha', comment: 'Cold <b>food</b>', draft: 'We are sorry.' };

beforeEach(() => {
  vi.clearAllMocks();
  n.email.mockResolvedValue({ ok: true });
  n.sms.mockResolvedValue({ ok: true });
  n.whatsapp.mockResolvedValue({ ok: true });
  n.phones.mockResolvedValue(['+919000000001']);
  db.restaurant.findUnique.mockImplementation(async (a: any) => a.select?.name
    ? { name: 'Spice Hub' }
    : { contactEmail: 'hello@spice.in', owner: { email: 'owner@spice.in' }, members: [{ user: { email: 'admin@spice.in' } }, { user: { email: 'owner@spice.in' } }] });
  db.googleReview.updateMany.mockResolvedValue({ count: 1 });
});

describe('formatNegativeAlert', () => {
  it('includes rating, comment, AI draft and a deep link; escapes HTML', () => {
    const m = formatNegativeAlert('Spice Hub', [bad]);
    expect(m.subject).toBe('[Spice Hub] New 1★ Google review');
    expect(m.text).toContain('Suggested reply: We are sorry.');
    expect(m.text).toContain(reviewLink('g1'));
    expect(m.html).toContain('Cold &lt;b&gt;food&lt;/b&gt;');
    expect(m.short.length).toBeLessThan(200);
  });
});

describe('restaurantEmailRecipients', () => {
  it('owner + admins + contact email, deduped, no platform super-admins', async () => {
    expect((await restaurantEmailRecipients('rest1')).sort()).toEqual(['admin@spice.in', 'hello@spice.in', 'owner@spice.in']);
  });
});

describe('sendNegativeReviewAlerts', () => {
  it('claims each review once (fresh only) and sends ONE email per recipient', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue({ alertEnabled: true, alertMaxRating: 2, alertSms: false, alertWhatsapp: false });
    const sent = await sendNegativeReviewAlerts('rest1', [bad, { ...bad, id: 'g2', rating: 2 }], now);
    expect(sent).toBe(2);
    const claim = db.googleReview.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'g1', restaurantId: 'rest1', alertedAt: null });
    expect(claim.where.reviewCreatedAt.gte).toEqual(new Date(now.getTime() - 48 * 3_600_000));
    expect(n.email).toHaveBeenCalledTimes(3);
    expect(n.email.mock.calls[0][0]).toMatchObject({ template: 'reviews.negative_alert', restaurantId: 'rest1' });
    expect(n.sms).not.toHaveBeenCalled();
  });
  it('skips reviews above the threshold and ones already claimed (debounce)', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue({ alertEnabled: true, alertMaxRating: 1 });
    db.googleReview.updateMany.mockResolvedValue({ count: 0 });
    expect(await sendNegativeReviewAlerts('rest1', [bad, { ...bad, id: 'g3', rating: 3 }], now)).toBe(0);
    expect(db.googleReview.updateMany).toHaveBeenCalledTimes(1);
    expect(n.email).not.toHaveBeenCalled();
  });
  it('does nothing when alerts are disabled', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue({ alertEnabled: false, alertMaxRating: 2 });
    expect(await sendNegativeReviewAlerts('rest1', [bad], now)).toBe(0);
    expect(db.googleReview.updateMany).not.toHaveBeenCalled();
  });
  it('defaults (no settings row): enabled at <= 2 stars', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue(null);
    expect(await sendNegativeReviewAlerts('rest1', [bad], now)).toBe(1);
  });
  it('adds SMS and WhatsApp when enabled', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue({ alertEnabled: true, alertMaxRating: 2, alertSms: true, alertWhatsapp: true });
    await sendNegativeReviewAlerts('rest1', [bad], now);
    expect(n.sms).toHaveBeenCalledWith(expect.objectContaining({ to: '+919000000001', template: 'reviews.negative_alert' }));
    expect(n.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ to: '+919000000001' }));
  });
  it('never throws', async () => {
    db.reviewResponseSettings.findUnique.mockRejectedValue(new Error('db down'));
    await expect(sendNegativeReviewAlerts('rest1', [bad], now)).resolves.toBe(0);
  });
});

describe('runSlaEscalations', () => {
  it('escalates each overdue review once to the second recipient', async () => {
    db.reviewResponseSettings.findMany.mockResolvedValue([{
      restaurantId: 'rest1', slaHours: 24, escalationEmail: 'gm@spice.in', escalationPhone: '+919000000002',
      createdAt: new Date('2026-01-01'), restaurant: { name: 'Spice Hub' },
    }]);
    db.googleReview.findMany.mockResolvedValue([{ id: 'g1', rating: 2, reviewerName: 'Asha' }, { id: 'g2', rating: 5, reviewerName: null }]);
    db.googleReview.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await runSlaEscalations(now)).toBe(1);
    const where = db.googleReview.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ restaurantId: 'rest1', escalatedAt: null });
    expect(where.AND[1].reviewCreatedAt.gte).toEqual(new Date(now.getTime() - 14 * 86_400_000));
    expect(n.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'gm@spice.in', template: 'reviews.sla_escalation' }));
    expect(n.sms).toHaveBeenCalledWith(expect.objectContaining({ to: '+919000000002' }));
  });
  it('sends nothing when nothing is overdue', async () => {
    db.reviewResponseSettings.findMany.mockResolvedValue([{ restaurantId: 'rest1', slaHours: 24, escalationEmail: 'gm@spice.in', escalationPhone: null, createdAt: now, restaurant: { name: 'S' } }]);
    db.googleReview.findMany.mockResolvedValue([]);
    expect(await runSlaEscalations(now)).toBe(0);
    expect(n.email).not.toHaveBeenCalled();
  });
});
