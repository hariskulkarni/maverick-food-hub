/**
 * Google-reviews sync + auto-reply sweep. Schedule every few minutes behind
 * INTERNAL_CRON_SECRET (see /api/platform/jobs/google-reviews/run).
 *
 * For each restaurant with a CONNECTED GOOGLE_BUSINESS integration: pull
 * reviews, upsert them, and for NEW ones apply the rating policy — 4-5* is
 * auto-posted, 1-3* becomes a PENDING_APPROVAL draft. A per-review error is
 * parked as FAILED and never aborts the sweep. A per-restaurant error (list,
 * config or DB) is logged and skips only that restaurant. A reply that Google
 * already accepted is never recorded as FAILED, so it cannot be re-posted by
 * hand. An advisory lock prevents two overlapping sweeps from double-replying.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { listReviews, postReply } from '@/server/reviews/google-business';
import { generateReviewReply, LlmNotConfiguredError } from '@/server/reviews/llm';
import { decideReplyAction } from '@/server/reviews/policy';
import { upsertReview, getAutoReplyConfig, saveReply } from '@/server/reviews/store';

const LOCK_KEY = 889_201_774; // arbitrary unique advisory-lock id for this sweep

type Generated = Awaited<ReturnType<typeof generateReviewReply>>;

export async function runGoogleReviewsSweep() {
  const result = { restaurantsScanned: 0, reviewsFound: 0, newReviews: 0, autoPosted: 0, drafted: 0, failed: 0 };

  const lock = (await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`)[0];
  if (!lock?.locked) { log.warn({}, 'reviews.sweep.skipped_locked'); return result; }

  try {
    const connected = await prisma.integrationCredential.findMany({
      where: { provider: 'GOOGLE_BUSINESS' as any, status: 'CONNECTED' as any },
      select: { restaurantId: true },
    });
    for (const { restaurantId } of connected) {
      result.restaurantsScanned++;
      try {
        let reviews;
        try {
          reviews = await listReviews(restaurantId);
        } catch (e: any) {
          log.error({ restaurantId, error: String(e?.message || e) }, 'reviews.sweep.list_failed');
          continue;
        }
        result.reviewsFound += reviews.length;
        const cfg = await getAutoReplyConfig(restaurantId);
        for (const r of reviews) {
          const { id, isNew } = await upsertReview(restaurantId, r);
          if (!isNew) continue;
          result.newReviews++;
          const action = decideReplyAction(r.rating, cfg);
          if (action === 'SKIP') continue;

          let gen: Generated | undefined;
          let posted = false;
          try {
            gen = await generateReviewReply({ restaurantId, rating: r.rating, comment: r.comment, tone: cfg?.tonePrompt });
            if (action === 'AUTO_POST') {
              await postReply(restaurantId, r.googleReviewId, gen.text);
              posted = true;
              await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'POSTED', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model, postedAt: new Date() });
              result.autoPosted++;
            } else {
              await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model });
              result.drafted++;
            }
          } catch (e: any) {
            // No LLM key configured: graceful SKIP (spec 6.4), not a failure.
            if (e instanceof LlmNotConfiguredError) {
              log.warn({ restaurantId, googleReviewId: r.googleReviewId }, 'reviews.sweep.no_llm_skip');
              continue;
            }
            const msg = String(e?.message || e);
            if (posted && gen) {
              // Google already has the reply. Record it as POSTED, never FAILED.
              try {
                await saveReply({
                  reviewId: id, restaurantId, text: gen.text, state: 'POSTED', source: 'AUTO',
                  llmProvider: gen.provider, llmModel: gen.model, postedAt: new Date(),
                  error: `post succeeded; delayed record: ${msg}`.slice(0, 300),
                });
                result.autoPosted++;
              } catch (se: any) {
                log.error({ restaurantId, googleReviewId: r.googleReviewId, error: String(se?.message || se) }, 'reviews.sweep.posted_unrecorded');
              }
            } else {
              try {
                await saveReply({ reviewId: id, restaurantId, text: gen?.text ?? '', state: 'FAILED', source: 'AUTO', error: msg.slice(0, 300) });
              } catch (se: any) {
                log.error({ restaurantId, googleReviewId: r.googleReviewId, error: String(se?.message || se) }, 'reviews.sweep.fail_save');
              }
              result.failed++;
            }
          }
        }
      } catch (e: any) {
        log.error({ restaurantId, error: String(e?.message || e) }, 'reviews.sweep.restaurant_failed');
      }
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
  log.info(result, 'reviews.sweep.done');
  return result;
}
