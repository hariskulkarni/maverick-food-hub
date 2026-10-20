import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(), auth: vi.fn(), audit: vi.fn(),
  searchBusiness: vi.fn(), fetchPlaceReviews: vi.fn(),
  upsertReview: vi.fn(), setPlacesLink: vi.fn(), getPlacesLink: vi.fn(), clearPlacesLink: vi.fn(),
  generateReviewReply: vi.fn(), getReviewScoped: vi.fn(), getAutoReplyConfig: vi.fn(),
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/reviews/places', async (orig) => ({
  ...(await orig<typeof import('@/server/reviews/places')>()),
  searchBusiness: h.searchBusiness, fetchPlaceReviews: h.fetchPlaceReviews,
}));
vi.mock('@/server/reviews/store', () => ({
  upsertReview: h.upsertReview, setPlacesLink: h.setPlacesLink, getPlacesLink: h.getPlacesLink,
  clearPlacesLink: h.clearPlacesLink, getReviewScoped: h.getReviewScoped, getAutoReplyConfig: h.getAutoReplyConfig,
}));
vi.mock('@/server/reviews/llm', async (orig) => ({
  ...(await orig<typeof import('@/server/reviews/llm')>()), generateReviewReply: h.generateReviewReply,
}));

import { POST as search } from '@/app/api/admin/reviews/places/search/route';
import { POST as connect } from '@/app/api/admin/reviews/places/connect/route';
import { POST as sync } from '@/app/api/admin/reviews/places/sync/route';
import { POST as disconnect } from '@/app/api/admin/reviews/places/disconnect/route';
import { POST as draft } from '@/app/api/admin/reviews/[id]/draft/route';
import { PlacesNotConfiguredError } from '@/server/reviews/places';

const req = (body?: unknown) => ({
  nextUrl: new URL('http://x/api/admin/reviews/places/x'),
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
}) as any;

const rv = (id: string) => ({ googleReviewId: id, reviewerName: 'A', rating: 5, comment: 'c', reviewCreatedAt: new Date(), source: 'places' as const });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.auth.mockResolvedValue({ user: { id: 'u1', role: 'RESTAURANT_ADMIN' } });
  h.upsertReview.mockResolvedValue({ id: 'g', isNew: true });
  h.fetchPlaceReviews.mockResolvedValue({ reviews: [rv('places:p1:1'), rv('places:p1:2')], rating: 4.5, total: 10 });
});

const forbid = () => h.requireManagedRestaurant.mockRejectedValue(new Response('Forbidden', { status: 403 }));

describe('places routes: authz', () => {
  it.each([
    ['search', () => search(req({ query: 'biryani' }))],
    ['connect', () => connect(req({ placeId: 'p1', name: 'N' }))],
    ['sync', () => sync(req())],
    ['disconnect', () => disconnect(req())],
  ])('%s returns 403 for a non-manager and does nothing', async (_n, call) => {
    forbid();
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.setPlacesLink).not.toHaveBeenCalled();
    expect(h.clearPlacesLink).not.toHaveBeenCalled();
    expect(h.searchBusiness).not.toHaveBeenCalled();
    expect(h.upsertReview).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  it('returns candidates', async () => {
    h.searchBusiness.mockResolvedValue([{ placeId: 'p1', name: 'N', address: 'A' }]);
    const res = await search(req({ query: 'biryani house' }));
    expect(await res.json()).toEqual({ candidates: [{ placeId: 'p1', name: 'N', address: 'A' }] });
  });
  it('400 on short query', async () => {
    expect((await search(req({ query: 'a' }))).status).toBe(400);
  });
  it('clear 503 when Places is not configured', async () => {
    h.searchBusiness.mockRejectedValue(new PlacesNotConfiguredError());
    const res = await search(req({ query: 'biryani' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });
});

describe('connect', () => {
  it('persists the link, upserts reviews as places, audits', async () => {
    const res = await connect(req({ placeId: 'p1', name: 'Biryani House' }));
    expect(res.status).toBe(200);
    expect(h.setPlacesLink).toHaveBeenCalledWith('rest1', { placeId: 'p1', name: 'Biryani House' });
    expect(h.upsertReview).toHaveBeenCalledTimes(2);
    expect(h.upsertReview.mock.calls[0][0]).toBe('rest1');
    expect(h.upsertReview.mock.calls[0][1].source).toBe('places');
    expect(h.audit).toHaveBeenCalledWith('reviews.places.connect', expect.objectContaining({ restaurantId: 'rest1' }));
    expect(await res.json()).toMatchObject({ ok: true, synced: 2 });
  });
  it('400 without placeId', async () => {
    expect((await connect(req({ name: 'x' }))).status).toBe(400);
    expect(h.setPlacesLink).not.toHaveBeenCalled();
  });
  it('still connects (does not 500) when the initial fetch fails', async () => {
    h.fetchPlaceReviews.mockResolvedValue({ reviews: [], rating: null, total: null, failed: true });
    const res = await connect(req({ placeId: 'p1', name: 'N' }));
    expect(res.status).toBe(200);
    expect((await res.json()).synced).toBe(0);
  });
});

describe('sync', () => {
  it('409 when not connected', async () => {
    h.getPlacesLink.mockResolvedValue(null);
    expect((await sync(req())).status).toBe(409);
  });
  it('re-fetches and upserts with source places', async () => {
    h.getPlacesLink.mockResolvedValue({ placeId: 'p1', name: 'N' });
    const res = await sync(req());
    expect(res.status).toBe(200);
    expect(h.fetchPlaceReviews).toHaveBeenCalledWith('p1');
    expect(h.upsertReview).toHaveBeenCalledTimes(2);
    expect(h.audit).toHaveBeenCalledWith('reviews.places.sync', expect.anything());
  });
  it('502 (not a crash) when Places fails', async () => {
    h.getPlacesLink.mockResolvedValue({ placeId: 'p1', name: 'N' });
    h.fetchPlaceReviews.mockResolvedValue({ reviews: [], rating: null, total: null, failed: true });
    expect((await sync(req())).status).toBe(502);
  });
});

describe('disconnect', () => {
  it('clears the link, removes places reviews, audits', async () => {
    const res = await disconnect(req());
    expect(res.status).toBe(200);
    expect(h.clearPlacesLink).toHaveBeenCalledWith('rest1');
    expect(h.audit).toHaveBeenCalledWith('reviews.places.disconnect', expect.objectContaining({ restaurantId: 'rest1' }));
  });
});

describe('AI draft (read-only, nothing persisted)', () => {
  const ctx = { params: Promise.resolve({ id: 'g1' }) };
  it('404 for a cross-tenant review', async () => {
    h.getReviewScoped.mockResolvedValue(null);
    expect((await draft(req(), ctx)).status).toBe(404);
  });
  it('returns generated text', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'g1', rating: 4, comment: 'nice' });
    h.getAutoReplyConfig.mockResolvedValue({ tonePrompt: 'warm' });
    h.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'openai', model: 'm' });
    const res = await draft(req(), ctx);
    expect(await res.json()).toEqual({ ok: true, text: 'Thanks!' });
    expect(h.generateReviewReply).toHaveBeenCalledWith({ restaurantId: 'rest1', rating: 4, comment: 'nice', tone: 'warm' });
  });
});
