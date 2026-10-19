import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  listForRestaurant: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/integrations', () => ({ listForRestaurant: h.listForRestaurant }));
vi.mock('@/server/db', () => ({
  prisma: { reviewAutoReplyConfig: { upsert: h.upsert, findUnique: h.findUnique } },
}));

import { GET, POST } from '@/app/api/admin/reviews/config/route';

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
});
