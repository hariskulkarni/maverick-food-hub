import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  createOrderFeedback: vi.fn(),
  openRecoveryTicket: vi.fn(),
  prisma: {
    reviewRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    reviewRequestConfig: { findUnique: vi.fn() },
    reviewAutoReplyConfig: { findUnique: vi.fn() },
    reviewRequestOptOut: { findFirst: vi.fn(), create: vi.fn() },
    order: { findUnique: vi.fn() },
  },
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ getConfig: vi.fn() }));
vi.mock('@/server/reviews/order-feedback-submit', () => ({ createOrderFeedback: h.createOrderFeedback }));
vi.mock('@/server/reviews/recovery', () => ({ openRecoveryTicket: h.openRecoveryTicket }));

import { submitFeedbackViaLink, optOutViaToken, recordClick, recordGoogleClick, isPreviewBot } from '@/server/reviews/review-link';

const NOW = new Date('2026-10-24T12:00:00Z');
const TOKEN = 'tok_abcdefghijklmnopqrstu';
const restaurant = { id: 'r1', name: 'Spice Hub', logoUrl: null, slug: 'spice' };
const orderReq = (feedback: unknown = null) => ({
  id: 'rr1', restaurantId: 'r1', feedbackAt: null, rating: null, comment: null, restaurant,
  order: {
    id: 'o1', code: 'ORD-1', status: 'DELIVERED', deliveredAt: new Date(NOW.getTime() - 3_600_000), updatedAt: NOW,
    items: [{ name: 'Biryani', quantity: 1 }], assignment: null, feedback,
  },
});
const qrReq = () => ({ id: 'rq1', restaurantId: 'r1', feedbackAt: null, rating: null, comment: null, restaurant, order: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.reviewRequestConfig.findUnique.mockResolvedValue({ enabled: true, channels: ['SMS'], lowRatingThreshold: 3, googleReviewUrlOverride: null, gbpReviewUrl: null, gbpPlaceId: null });
  h.prisma.reviewAutoReplyConfig.findUnique.mockResolvedValue({ googlePlaceId: 'PLACE1' });
  h.prisma.order.findUnique.mockResolvedValue({ customerId: 'u1', code: 'ORD-1', deliveredAt: new Date(NOW.getTime() - 3_600_000), updatedAt: NOW, assignment: null });
  h.createOrderFeedback.mockImplementation(async (a: any) => ({ feedback: {}, ticketOpened: a.data.overallRating <= 3 }));
  h.prisma.reviewRequest.updateMany.mockResolvedValue({ count: 1 });
  h.openRecoveryTicket.mockResolvedValue({ created: true, id: 't1' });
});

describe('submitFeedbackViaLink — Google link at every rating (no gating)', () => {
  it('returns the identical Google URL for ratings 1..5 on order asks', async () => {
    const urls = new Set<string | null>();
    for (const rating of [1, 2, 3, 4, 5]) {
      h.prisma.reviewRequest.findUnique.mockResolvedValueOnce(orderReq());
      const r = await submitFeedbackViaLink(TOKEN, { rating }, NOW);
      expect(r.ok).toBe(true);
      if (r.ok) urls.add(r.googleUrl);
    }
    expect([...urls]).toEqual(['https://search.google.com/local/writereview?placeid=PLACE1']);
  });

  it('saves as OrderFeedback on behalf of the order customer and reports recovery for low ratings', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue(orderReq());
    const r = await submitFeedbackViaLink(TOKEN, { rating: 2, comment: 'cold' }, NOW);
    expect(h.createOrderFeedback).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o1', customerId: 'u1', data: { overallRating: 2, comment: 'cold' }, via: 'review_link',
    }));
    expect(r).toMatchObject({ ok: true, ticketOpened: true });
  });

  it('refuses a second submission and closed windows (Google link still rendered by the page)', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue(orderReq({ overallRating: 5, comment: null }));
    expect(await submitFeedbackViaLink(TOKEN, { rating: 4 }, NOW)).toMatchObject({ ok: false, status: 409 });
    const late = new Date(NOW.getTime() + 3 * 86_400_000);
    h.prisma.reviewRequest.findUnique.mockResolvedValue(orderReq());
    expect(await submitFeedbackViaLink(TOKEN, { rating: 4 }, late)).toMatchObject({ ok: false, status: 409, error: 'Feedback window closed' });
    expect(h.createOrderFeedback).not.toHaveBeenCalled();
  });

  it('QR asks store the rating on the request; low ratings open a ticket with volunteered contact', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue(qrReq());
    const r = await submitFeedbackViaLink(TOKEN, { rating: 1, comment: 'rude', contactPhone: '+91999' }, NOW);
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'rq1', feedbackAt: null },
      data: { feedbackAt: NOW, status: 'FEEDBACK', rating: 1, comment: 'rude' },
    });
    expect(h.openRecoveryTicket).toHaveBeenCalledWith(expect.objectContaining({ orderId: null, rating: 1, contactPhone: '+91999' }));
    expect(r).toMatchObject({ ok: true, ticketOpened: true, googleUrl: expect.stringContaining('PLACE1') });

    vi.clearAllMocks();
    h.prisma.reviewRequest.findUnique.mockResolvedValue(qrReq());
    h.prisma.reviewRequest.updateMany.mockResolvedValue({ count: 1 });
    const hi = await submitFeedbackViaLink(TOKEN, { rating: 5 }, NOW);
    expect(h.openRecoveryTicket).not.toHaveBeenCalled();
    expect(hi).toMatchObject({ ok: true, ticketOpened: false, googleUrl: expect.stringContaining('PLACE1') });
  });

  it('404s an unknown token', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue(null);
    expect(await submitFeedbackViaLink(TOKEN, { rating: 5 }, NOW)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('optOutViaToken', () => {
  it('records a restaurant opt-out once and cancels pending asks + reminders', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue({ customerId: 'u1', restaurantId: 'r1' });
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue(null);
    expect(await optOutViaToken(TOKEN, 'restaurant')).toEqual({ ok: true });
    expect(h.prisma.reviewRequestOptOut.create).toHaveBeenCalledWith({ data: { customerId: 'u1', restaurantId: 'r1', sourceRestaurantId: 'r1' } });
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'u1', status: 'SCHEDULED', restaurantId: 'r1' }, data: { status: 'SKIPPED', error: 'opted_out' },
    });
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue({ id: 'x' });
    await optOutViaToken(TOKEN, 'restaurant');
    expect(h.prisma.reviewRequestOptOut.create).toHaveBeenCalledTimes(1);
  });

  it('global opt-out has restaurantId null and cancels across restaurants', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue({ customerId: 'u1', restaurantId: 'r1' });
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue(null);
    await optOutViaToken(TOKEN, 'all');
    expect(h.prisma.reviewRequestOptOut.create).toHaveBeenCalledWith({ data: { customerId: 'u1', restaurantId: null, sourceRestaurantId: 'r1' } });
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].where).toEqual({ customerId: 'u1', status: 'SCHEDULED' });
  });

  it('rejects QR links (no customer) and unknown tokens', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue({ customerId: null, restaurantId: 'r1' });
    expect((await optOutViaToken(TOKEN, 'all')).ok).toBe(false);
    h.prisma.reviewRequest.findUnique.mockResolvedValue(null);
    expect((await optOutViaToken(TOKEN, 'all')).ok).toBe(false);
  });
});

describe('click tracking', () => {
  it('stamps the first click only and moves SENT → CLICKED', async () => {
    h.prisma.reviewRequest.findUnique.mockResolvedValue({ id: 'rr1', status: 'SENT', clickedAt: null });
    await recordClick(TOKEN, NOW);
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({ where: { id: 'rr1', clickedAt: null }, data: { clickedAt: NOW } });
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({ where: { id: 'rr1', status: 'SENT' }, data: { status: 'CLICKED' } });
    vi.clearAllMocks();
    h.prisma.reviewRequest.findUnique.mockResolvedValue({ id: 'rr1', status: 'CLICKED', clickedAt: NOW });
    await recordClick(TOKEN, NOW);
    expect(h.prisma.reviewRequest.updateMany).not.toHaveBeenCalled();
  });

  it('Google click counted once; preview bots ignored', async () => {
    h.prisma.reviewRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await recordGoogleClick(TOKEN, NOW)).toBe(true);
    expect(await recordGoogleClick(TOKEN, NOW)).toBe(false);
    expect(isPreviewBot('WhatsApp/2.23')).toBe(true);
    expect(isPreviewBot('facebookexternalhit/1.1')).toBe(true);
    expect(isPreviewBot('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile')).toBe(false);
  });
});
