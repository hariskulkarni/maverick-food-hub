/**
 * Post an owner-approved/typed reply to Google with the safety filter in front
 * and Google errors mapped to an owner-safe message:
 *  - unsafe text  → 422 { error, issues } (nothing posted, nothing stored);
 *  - Places review → 400 (read-only source; reply in Google's UI);
 *  - not connected → 409; any other Google error → reply stored as FAILED with
 *    the safe message (so the inbox shows Retry) and 502 { error }.
 */
import { postReply, safeErrorMessage } from './google-business';
import { saveReply } from './store';
import { privateTermsFor } from './drafting';
import { checkReplySafety, summarizeIssues } from '@/lib/review-reply-safety';
import { log } from '@/server/log';
import type { ReviewReplySource } from '@prisma/client';

export type PostableReview = {
  id: string; googleReviewId: string; source?: string | null;
  matchedOrderId?: string | null; matchConfidence?: number | null;
};

export const MAX_REPLY_CHARS = 4000;

export async function postAndRecord(
  restaurantId: string, review: PostableReview, text: string, source: ReviewReplySource,
): Promise<Response> {
  const body = text.trim();
  if (!body) return Response.json({ error: 'Reply text is required' }, { status: 400 });
  if (body.length > MAX_REPLY_CHARS) return Response.json({ error: `Reply must be ${MAX_REPLY_CHARS} characters or fewer` }, { status: 400 });
  if (review.source === 'places') {
    return Response.json({ error: 'This review came from Google Places (read-only). Reply on Google directly.' }, { status: 400 });
  }
  const { terms } = await privateTermsFor(restaurantId, review);
  const issues = checkReplySafety(body, terms);
  if (issues.length) return Response.json({ error: summarizeIssues(issues), issues }, { status: 422 });

  let meta;
  try {
    meta = await postReply(restaurantId, review.googleReviewId, body);
  } catch (e) {
    const safe = safeErrorMessage(e);
    log.warn({ restaurantId, reviewId: review.id, error: String((e as Error)?.message ?? e).slice(0, 300) }, 'reviews.reply.post_failed');
    await saveReply({ reviewId: review.id, restaurantId, text: body, state: 'FAILED', source, error: safe })
      .catch(() => undefined);
    return Response.json({ error: safe }, { status: /not connected/i.test(safe) ? 409 : 502 });
  }
  await saveReply({ reviewId: review.id, restaurantId, text: body, state: 'POSTED', source, postedAt: new Date(), meta });
  return Response.json({ ok: true, moderationState: meta?.moderationState ?? null });
}
