import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  listForRestaurant: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  restaurantUpdate: vi.fn(),
  auditReview: vi.fn(),
}));
vi.mock('@/server/tenancy', async () => ({ requireManagedRestaurant: h.requireManagedRestaurant, ...(await import('../../helpers/tenant-admin-mock')).tenantAdminMocks((rid) => (h.requireManagedRestaurant)(rid)) }));
vi.mock('@/server/integrations', () => ({ listForRestaurant: h.listForRestaurant }));
vi.mock('@/server/reviews/review-audit', () => ({ auditReview: h.auditReview }));
vi.mock('@/server/db', () => ({
  prisma: { reviewAutoReplyConfig: { upsert: h.upsert, findUnique: h.findUnique }, restaurant: { update: h.restaurantUpdate } },
}));

import { GET, POST, PATCH } from '@/app/api/admin/reviews/config/route';

const post = (body: unknown) =>
  new NextRequest('http://x/api/admin/reviews/config', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
});

describe('reviews config route', () => {
  it('POST upserts valid thresholds', async () => {
    h.upsert.mockResolvedValue({});
    const res = await POST(post({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: 'warm' }));
    expect(res.status).toBe(200);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const arg = h.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ restaurantId: 'rest1' });
    expect(arg.create).toMatchObject({ restaurantId: 'rest1', enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: 'warm' });
    expect(arg.update).toMatchObject({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: 'warm' });
  });

  it('POST stamps enabledAt when turning on from off/absent', async () => {
    h.findUnique.mockResolvedValue(null);
    await POST(post({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3 }));
    const arg = h.upsert.mock.calls[0][0];
    expect(arg.update.enabledAt).toBeInstanceOf(Date);
    expect(arg.create.enabledAt).toBeInstanceOf(Date);
  });

  it('POST preserves enabledAt when already enabled', async () => {
    const prev = new Date('2025-01-01');
    h.findUnique.mockResolvedValue({ enabled: true, enabledAt: prev });
    await POST(post({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3 }));
    expect(h.upsert.mock.calls[0][0].update.enabledAt).toBe(prev);
  });

  it('POST rejects draftMaxRating >= autoPostMinRating with 400', async () => {
    const res = await POST(post({ autoPostMinRating: 3, draftMaxRating: 3 }));
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('POST rejects out-of-range ratings', async () => {
    const res = await POST(post({ autoPostMinRating: 6, draftMaxRating: 3 }));
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('GET returns masked summaries only', async () => {
    h.listForRestaurant.mockResolvedValue([
      { provider: 'GOOGLE_BUSINESS', status: 'CONNECTED', summary: { accountId: 'a1', locationId: 'l1' } },
      { provider: 'LLM_REVIEWS', status: 'CONNECTED', summary: { provider: 'nvidia', apiKey: '••••abcd', model: 'm' } },
    ]);
    h.findUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://x/api/admin/reviews/config'));
    const body = await res.json();
    expect(body.google.status).toBe('CONNECTED');
    expect(body.llm.summary.model).toBe('m');
    expect(body.autoReply).toEqual({ enabled: false, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null });
    const s = JSON.stringify(body);
    expect(s).not.toContain('refreshToken');
    expect(s).not.toContain('configEncrypted');
    expect(s).not.toContain('sk-');
  });

  it('GET exposes autoPublishReviews (default true)', async () => {
    h.listForRestaurant.mockResolvedValue([]);
    h.findUnique.mockResolvedValue(null);
    h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1', autoPublishReviews: false });
    expect((await (await GET(new NextRequest('http://x/api/admin/reviews/config'))).json()).autoPublishReviews).toBe(false);
    h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
    expect((await (await GET(new NextRequest('http://x/api/admin/reviews/config'))).json()).autoPublishReviews).toBe(true);
  });

  it('PATCH persists autoPublishReviews on the restaurant', async () => {
    h.restaurantUpdate.mockResolvedValue({});
    const res = await PATCH(new NextRequest('http://x/api/admin/reviews/config', {
      method: 'PATCH', body: JSON.stringify({ autoPublishReviews: false }), headers: { 'content-type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    expect(h.restaurantUpdate).toHaveBeenCalledWith({ where: { id: 'rest1' }, data: { autoPublishReviews: false } });
  });

  it('PATCH rejects non-boolean', async () => {
    const res = await PATCH(new NextRequest('http://x/api/admin/reviews/config', {
      method: 'PATCH', body: JSON.stringify({ autoPublishReviews: 'no' }), headers: { 'content-type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    expect(h.restaurantUpdate).not.toHaveBeenCalled();
  });

  it('POST audits the config change with before/after', async () => {
    h.findUnique.mockResolvedValue({ enabled: false, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: null });
    await POST(post({ enabled: true, autoPostMinRating: 5, draftMaxRating: 2 }));
    expect(h.auditReview).toHaveBeenCalledWith('reviews.config.update', 'rest1', expect.objectContaining({
      before: expect.objectContaining({ enabled: false }), after: expect.objectContaining({ enabled: true, autoPostMinRating: 5 }),
    }));
  });

  it('PATCH audits the publish toggle', async () => {
    await PATCH(new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify({ autoPublishReviews: false }) }));
    expect(h.auditReview).toHaveBeenCalledWith('reviews.publish.update', 'rest1', expect.objectContaining({ after: { autoPublishReviews: false } }));
  });
});
