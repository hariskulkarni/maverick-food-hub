import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { fetchReviews, safeErrorMessage } from '@/server/reviews/google-business';
import { upsertReview, syncGoogleReply, saveGoogleStats } from '@/server/reviews/store';
import { invalidateAnalysis } from '@/server/reviews/insights';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual "Sync from Google": pulls every page, refreshes edited reviews and
 * mirrors replies already on Google (no AI calls, nothing posted). Drafting and
 * auto-posting stay with the scheduled sweep.
 */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    let fetched;
    try {
      fetched = await fetchReviews(restaurant.id);
    } catch (e) {
      const msg = safeErrorMessage(e);
      if (/not connected/i.test(msg)) return Response.json({ error: 'Google Business not connected' }, { status: 409 });
      return Response.json({ error: `Google sync failed: ${msg}` }, { status: 502 });
    }
    await saveGoogleStats(restaurant.id, fetched).catch(() => undefined);
    let created = 0;
    let failed = 0;
    let repliesImported = 0;
    for (const r of fetched.reviews) {
      try {
        const { id, isNew, edited } = await upsertReview(restaurant.id, r);
        if (isNew) created++;
        if (edited) await invalidateAnalysis(id);
        if (r.existingReply && (await syncGoogleReply(id, restaurant.id, r.existingReply))) repliesImported++;
      } catch {
        failed++; // isolate a bad row; keep syncing the rest
      }
    }
    const out = { synced: fetched.reviews.length - failed, created, failed, repliesImported };
    await auditReview('reviews.sync', restaurant.id, { after: out });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
