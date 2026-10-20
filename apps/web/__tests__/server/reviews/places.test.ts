import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const logSpy = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/server/log', () => ({ log: logSpy }));
import { searchBusiness, fetchPlaceReviews, PlacesNotConfiguredError } from '@/server/reviews/places';

const KEY = 'AIza-SECRET-KEY-123';
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as any;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = KEY;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_PLACES_API_KEY; vi.restoreAllMocks(); });

describe('searchBusiness', () => {
  it('parses candidates and biases to India', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'OK', results: [
      { place_id: 'p1', name: 'Biryani House', formatted_address: 'MG Road, Bengaluru' },
      { place_id: 'p2', name: 'Dosa Corner', formatted_address: 'Indiranagar' },
    ] }));
    const out = await searchBusiness('biryani');
    expect(out).toEqual([
      { placeId: 'p1', name: 'Biryani House', address: 'MG Road, Bengaluru' },
      { placeId: 'p2', name: 'Dosa Corner', address: 'Indiranagar' },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('textsearch');
    expect(url).toContain('region=in');
  });

  it('throws a typed error when the key is unset (and never calls fetch)', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(searchBusiness('x y')).rejects.toBeInstanceOf(PlacesNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] on an upstream failure instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => KEY, json: async () => ({}) });
    expect(await searchBusiness('biryani')).toEqual([]);
  });
});

describe('fetchPlaceReviews', () => {
  const body = { status: 'OK', result: { name: 'Biryani House', rating: 4.4, user_ratings_total: 321, reviews: [
    { author_name: 'Asha', rating: 5, text: 'Great', time: 1760000000 },
    { author_name: 'Ravi', rating: 2, text: '', time: 1759000000 },
  ] } };

  it('maps reviews with deterministic ids and requests only needed fields', async () => {
    fetchMock.mockResolvedValue(ok(body));
    const out = await fetchPlaceReviews('p1');
    expect(out.rating).toBe(4.4);
    expect(out.total).toBe(321);
    expect(out.reviews).toEqual([
      { googleReviewId: 'places:p1:1760000000', reviewerName: 'Asha', rating: 5, comment: 'Great', reviewCreatedAt: new Date(1760000000 * 1000), source: 'places' },
      { googleReviewId: 'places:p1:1759000000', reviewerName: 'Ravi', rating: 2, comment: null, reviewCreatedAt: new Date(1759000000 * 1000), source: 'places' },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('fields=reviews%2Crating%2Cuser_ratings_total%2Cname');
  });

  it('is idempotent: same input yields the same ids', async () => {
    fetchMock.mockResolvedValue(ok(body));
    const a = await fetchPlaceReviews('p1');
    const b = await fetchPlaceReviews('p1');
    expect(a.reviews.map((r) => r.googleReviewId)).toEqual(b.reviews.map((r) => r.googleReviewId));
  });

  it('caps at 5 reviews', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ author_name: 'a', rating: 5, text: 't', time: 1700000000 + i }));
    fetchMock.mockResolvedValue(ok({ status: 'OK', result: { reviews: many } }));
    expect((await fetchPlaceReviews('p1')).reviews).toHaveLength(5);
  });

  it('returns a safe empty result on 4xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad', json: async () => ({}) });
    expect(await fetchPlaceReviews('p1')).toEqual({ reviews: [], rating: null, total: null, failed: true });
  });

  it('returns a safe empty result on timeout/network error', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    expect((await fetchPlaceReviews('p1')).reviews).toEqual([]);
  });

  it('treats REQUEST_DENIED status bodies as failure', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'REQUEST_DENIED', error_message: 'key bad' }));
    expect((await fetchPlaceReviews('p1')).failed).toBe(true);
  });

  it('unset key -> safe empty (does not throw)', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect((await fetchPlaceReviews('p1')).reviews).toEqual([]);
  });

  it('never logs the API key, even when upstream echoes it', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => `denied ${KEY}`, json: async () => ({}) });
    await fetchPlaceReviews('p1');
    await searchBusiness('biryani');
    fetchMock.mockRejectedValue(new Error(`fetch failed https://x?key=${KEY}`));
    await fetchPlaceReviews('p1');
    for (const l of Object.values(logSpy)) expect(JSON.stringify(l.mock.calls)).not.toContain(KEY);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(KEY);
  });
});
