import { fetchPlaceReviews } from './places';
import { upsertReview } from './store';

/** Fetch + upsert Places reviews for a tenant. Never throws on a Places failure; reports fetchFailed. */
export async function syncPlacesReviews(restaurantId: string, placeId: string) {
  const res = await fetchPlaceReviews(placeId);
  let created = 0;
  let failed = 0;
  for (const r of res.reviews) {
    try {
      const { isNew } = await upsertReview(restaurantId, { ...r, source: 'places' });
      if (isNew) created++;
    } catch {
      failed++;
    }
  }
  return { synced: res.reviews.length - failed, created, failed, fetchFailed: !!res.failed };
}
