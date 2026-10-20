/**
 * Google Places (standard API) adapter: Tier-1, no-approval review visibility.
 *
 * Needs only GOOGLE_PLACES_API_KEY (billing-enabled; NO Business Profile access
 * application). Read-only: replies cannot be posted via Places.
 *
 * LIMIT: Place Details returns at most 5 "most relevant/recent" reviews and has
 * no pagination. Full history + in-app replies need the GBP module (Tier 2).
 *
 * SECURITY: the legacy Places endpoints take the key as a `key=` query param, so
 * request URLs contain the secret. We therefore never log URLs, error messages
 * or response bodies from here; failures are logged by status/kind only.
 */
import { log } from '@/server/log';
import type { NormalizedReview } from './google-business';

const BASE = 'https://maps.googleapis.com/maps/api/place';
const TIMEOUT_MS = 8000;
export const PLACES_MAX_REVIEWS = 5;

export class PlacesNotConfiguredError extends Error {
  constructor() { super('Google Places is not configured'); this.name = 'PlacesNotConfiguredError'; }
}
export class PlacesRequestError extends Error {
  constructor() { super('Google Places request failed'); this.name = 'PlacesRequestError'; }
}

export type PlaceCandidate = { placeId: string; name: string; address: string };
export type PlaceReviewsResult = {
  reviews: NormalizedReview[]; rating: number | null; total: number | null; failed?: boolean;
};

function apiKey(): string {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k) throw new PlacesNotConfiguredError();
  return k;
}

/** GET + parse. Throws PlacesRequestError (secret-free) on any failure. */
async function getJson(path: string, params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}/json?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    log.warn({ path, kind: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' }, 'reviews.places.failed');
    throw new PlacesRequestError();
  }
  if (!res.ok) {
    log.warn({ path, status: res.status }, 'reviews.places.failed');
    throw new PlacesRequestError();
  }
  let data: any;
  try { data = await res.json(); } catch { throw new PlacesRequestError(); }
  const status = data?.status;
  if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
    log.warn({ path, status: String(status) }, 'reviews.places.failed');
    throw new PlacesRequestError();
  }
  return data;
}

/** Text Search, India-biased. Throws PlacesNotConfiguredError if no key; other failures return []. */
export async function searchBusiness(query: string): Promise<PlaceCandidate[]> {
  const key = apiKey();
  try {
    const data = await getJson('textsearch', { query: query.trim(), region: 'in' }, key);
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .filter((r: any) => r?.place_id && r?.name)
      .slice(0, 8)
      .map((r: any) => ({
        placeId: String(r.place_id), name: String(r.name), address: String(r.formatted_address ?? ''),
      }));
  } catch {
    return [];
  }
}

/** Place Details (reviews, rating, count). Never throws: failures yield an empty result with failed=true. */
export async function fetchPlaceReviews(placeId: string): Promise<PlaceReviewsResult> {
  const empty: PlaceReviewsResult = { reviews: [], rating: null, total: null, failed: true };
  let key: string;
  try { key = apiKey(); } catch { return empty; }
  try {
    const data = await getJson('details', { place_id: placeId, fields: 'reviews,rating,user_ratings_total,name' }, key);
    const result = data?.result ?? {};
    const raw = Array.isArray(result.reviews) ? result.reviews : [];
    const reviews: NormalizedReview[] = raw
      .filter((r: any) => Number.isFinite(Number(r?.time)))
      .slice(0, PLACES_MAX_REVIEWS)
      .map((r: any) => ({
        googleReviewId: `places:${placeId}:${r.time}`,
        reviewerName: r.author_name ? String(r.author_name) : null,
        rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 0))),
        comment: r.text && String(r.text).trim() ? String(r.text) : null,
        reviewCreatedAt: new Date(Number(r.time) * 1000),
        source: 'places' as const,
      }));
    return {
      reviews,
      rating: typeof result.rating === 'number' ? result.rating : null,
      total: typeof result.user_ratings_total === 'number' ? result.user_ratings_total : null,
    };
  } catch {
    return empty;
  }
}
