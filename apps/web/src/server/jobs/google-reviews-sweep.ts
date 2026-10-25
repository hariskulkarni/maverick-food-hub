/**
 * Google-reviews sync + auto-reply sweep. Runs every 15 minutes behind
 * INTERNAL_CRON_SECRET (see /api/platform/jobs/google-reviews/run and
 * deploy/flavrly-jobs.cron); a verified Pub/Sub push can also trigger it for
 * one restaurant.
 *
 * For each restaurant with a CONNECTED GOOGLE_BUSINESS integration:
 *  1. pull reviews (paginated; incremental 14-day horizon, full on first import
 *     and in the daily 03:00 IST run) + Google's location totals; upsert, refreshing
 *     edited reviews; mirror replies that already exist on Google as
 *     POSTED/MANUAL (no LLM call) and refresh their moderation state;
 *  2. learn the brand voice from the last ~20 posted replies;
 *  3. for reviews with no reply yet (forward-only, after enabledAt) apply the
 *     rules: rating >= autoPost → AUTO_POST unless the comment mentions a
 *     configured sensitive keyword or the draft fails the safety filter (then
 *     held as PENDING_APPROVAL with a reason); rating <= draftMax → draft for
 *     approval; in between → SKIPPED with the reason;
 *  4. alert owners about fresh low-rated reviews (with an AI draft when a key exists);
 *  5. recompute cached insights.
 * Then one SLA-escalation pass across restaurants.
 *
 * A per-review error is parked as FAILED and never aborts the sweep. A
 * per-restaurant error is logged and skips only that restaurant. A reply that
 * Google already accepted is never recorded as FAILED, so it cannot be
 * re-posted by hand. A job lease (server/jobs/lease.ts) prevents overlapping sweeps.
 */
import { prisma } from '@/server/db';
import { acquireJobLease, releaseJobLease } from '@/server/jobs/lease';
import { log } from '@/server/log';
import { fetchReviews, postReply, safeErrorMessage, type NormalizedReview } from '@/server/reviews/google-business';
import { LlmNotConfiguredError } from '@/server/reviews/llm';
import { decideReplyAction, findSensitiveKeyword } from '@/server/reviews/policy';
import {
  upsertReview, getAutoReplyConfig, saveReply, hasReply, syncGoogleReply,
  getResponseSettings, saveGoogleStats, recentPostedReplies,
} from '@/server/reviews/store';
import { draftReply, type Draft } from '@/server/reviews/drafting';
import { matchAndStore } from '@/server/reviews/order-match';
import { summarizeBrandVoice } from '@/server/reviews/voice';
import { refreshInsights, invalidateAnalysis } from '@/server/reviews/insights';
import { sendNegativeReviewAlerts, runSlaEscalations, ALERT_FRESH_HOURS, type AlertReview } from '@/server/reviews/review-alerts';

// F9: overlap guard is a job lease (row with expiry), not a session advisory lock.
const SWEEP_LEASE = 'google-reviews-sweep';
const SWEEP_LEASE_TTL_MS = 30 * 60_000; // above the worst-case multi-restaurant run
const MATCH_LOOKBACK_MS = 14 * 86_400_000;
const VOICE_REFRESH_MS = 24 * 3_600_000;
const INCREMENTAL_HORIZON_MS = 14 * 86_400_000;

/** True for the sweep run in the 03:00–03:14 IST slot (IST = UTC+5:30). */
export function isDailyFullSyncSlot(now: Date): boolean {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() === 3 && ist.getUTCMinutes() < 15;
}

type Pending = { id: string; r: NormalizedReview; matchedOrderId: string | null; matchConfidence: number | null; handled: boolean };

export async function runGoogleReviewsSweep(opts: { restaurantIds?: string[]; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const result = {
    restaurantsScanned: 0, reviewsFound: 0, newReviews: 0, autoPosted: 0, drafted: 0, failed: 0,
    repliesImported: 0, held: 0, skipped: 0, alerted: 0, escalated: 0,
  };

  const lease = await acquireJobLease(SWEEP_LEASE, SWEEP_LEASE_TTL_MS);
  if (!lease) { log.warn({}, 'reviews.sweep.skipped_locked'); return result; }

  try {
    const connected = await prisma.integrationCredential.findMany({
      where: {
        provider: 'GOOGLE_BUSINESS' as any, status: 'CONNECTED' as any,
        ...(opts.restaurantIds ? { restaurantId: { in: opts.restaurantIds } } : {}),
      },
      select: { restaurantId: true },
    });
    for (const { restaurantId } of connected) {
      result.restaurantsScanned++;
      try {
        let fetched;
        try {
          // Incremental by default (14-day update horizon) to spare API quota; full
          // sync on first import and once a day (the 03:00 IST run).
          const hasAny = (await prisma.googleReview.count({ where: { restaurantId, source: 'gbp' } })) > 0;
          const full = !hasAny || isDailyFullSyncSlot(now);
          fetched = await fetchReviews(restaurantId, full ? {} : { stopBefore: new Date(now.getTime() - INCREMENTAL_HORIZON_MS) });
        } catch (e: any) {
          log.error({ restaurantId, error: String(e?.message || e) }, 'reviews.sweep.list_failed');
          continue;
        }
        const reviews = fetched.reviews;
        result.reviewsFound += reviews.length;
        await saveGoogleStats(restaurantId, fetched).catch(() => undefined);
        const cfg = await getAutoReplyConfig(restaurantId);
        const settings = await getResponseSettings(restaurantId);

        // Pass 1: persist, mirror Google-side replies, collect reviews needing a reply.
        const pending: Pending[] = [];
        const alertCandidates = new Map<string, AlertReview>();
        const freshSince = now.getTime() - ALERT_FRESH_HOURS * 3_600_000;
        for (const r of reviews) {
          const { id, isNew, edited } = await upsertReview(restaurantId, r);
          if (isNew) result.newReviews++;
          if (edited) await invalidateAnalysis(id).catch(() => undefined);
          if (r.existingReply) {
            if (await syncGoogleReply(id, restaurantId, r.existingReply)) result.repliesImported++;
            continue; // already answered on Google: never generate or post
          }
          if (isNew && r.rating <= settings.alertMaxRating && r.reviewCreatedAt.getTime() >= freshSince) {
            alertCandidates.set(id, { id, rating: r.rating, reviewerName: r.reviewerName, comment: r.comment, draft: null });
          }
          if (await hasReply(id)) continue; // already replied / drafted / recorded
          let match = null;
          if (isNew && now.getTime() - r.reviewCreatedAt.getTime() < MATCH_LOOKBACK_MS) {
            match = await matchAndStore(restaurantId, { id, reviewerName: r.reviewerName, reviewCreatedAt: r.reviewCreatedAt }).catch(() => null);
          }
          pending.push({ id, r, matchedOrderId: match?.orderId ?? null, matchConfidence: match?.confidence ?? null, handled: false });
        }

        // Brand voice from the restaurant's own posted replies (refreshed daily).
        let voice = settings.brandVoiceSummary;
        if (!settings.brandVoiceUpdatedAt || now.getTime() - settings.brandVoiceUpdatedAt.getTime() > VOICE_REFRESH_MS) {
          voice = summarizeBrandVoice(await recentPostedReplies(restaurantId));
          await prisma.reviewResponseSettings.upsert({
            where: { restaurantId },
            create: { restaurantId, brandVoiceSummary: voice, brandVoiceUpdatedAt: now },
            update: { brandVoiceSummary: voice, brandVoiceUpdatedAt: now },
          }).catch(() => undefined);
        }
        const draftFor = (p: Pending) => draftReply(
          restaurantId,
          { id: p.id, rating: p.r.rating, comment: p.r.comment, matchedOrderId: p.matchedOrderId, matchConfidence: p.matchConfidence },
          { tone: cfg?.tonePrompt, voice },
        );

        // Pass 2: rules → draft / post / hold / skip.
        for (const p of pending) {
          const { id, r } = p;
          if (!cfg?.enabled) continue;
          // forward-only, fail-closed: no enabledAt, or review predates enabling -> never auto-reply
          if (!cfg.enabledAt || r.reviewCreatedAt < cfg.enabledAt) continue;
          let action = decideReplyAction(r.rating, cfg);
          p.handled = true;
          if (action === 'SKIP') {
            await saveReply({
              reviewId: id, restaurantId, text: '', state: 'SKIPPED', source: 'AUTO',
              holdReason: `Rated ${r.rating}★: between your auto-post (${cfg.autoPostMinRating}★+) and approval (≤${cfg.draftMaxRating}★) thresholds. Reply manually if you like.`,
            });
            result.skipped++;
            continue;
          }
          let holdReason: string | null = null;
          const keyword = action === 'AUTO_POST' ? findSensitiveKeyword(r.comment, settings.skipKeywords) : null;
          if (keyword) { action = 'DRAFT'; holdReason = `Mentions "${keyword}": held for your approval instead of auto-posting.`; }

          let gen: Draft | undefined;
          let posted = false;
          try {
            gen = await draftFor(p);
            if (action === 'AUTO_POST' && gen.issues.length) { action = 'DRAFT'; holdReason = gen.holdReason; }
            const alert = alertCandidates.get(id);
            if (alert) alert.draft = gen.text;
            if (action === 'AUTO_POST') {
              const meta = await postReply(restaurantId, r.googleReviewId, gen.text);
              posted = true;
              await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'POSTED', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model, postedAt: new Date(), meta });
              result.autoPosted++;
            } else {
              await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model, holdReason: holdReason ?? gen.holdReason });
              if (holdReason || gen.holdReason) result.held++;
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
              log.warn({ restaurantId, googleReviewId: r.googleReviewId, error: msg.slice(0, 300) }, 'reviews.sweep.reply_failed');
              try {
                // Owner-facing message only; the raw upstream detail stays in server logs.
                const safe = gen ? safeErrorMessage(e) : 'AI draft failed. Check your AI key in Settings or retry.';
                await saveReply({ reviewId: id, restaurantId, text: gen?.text ?? '', state: 'FAILED', source: 'AUTO', error: safe });
              } catch (se: any) {
                log.error({ restaurantId, googleReviewId: r.googleReviewId, error: String(se?.message || se) }, 'reviews.sweep.fail_save');
              }
              result.failed++;
            }
          }
        }

        // Alerts for fresh low-rated reviews. When auto-reply did not draft one
        // (off, or before enabledAt) prepare an approval draft so the alert can carry it.
        for (const p of pending) {
          const alert = alertCandidates.get(p.id);
          if (!alert || alert.draft || p.handled) continue;
          try {
            const gen = await draftFor(p);
            alert.draft = gen.text;
            await saveReply({ reviewId: p.id, restaurantId, text: gen.text, state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model, holdReason: gen.holdReason });
            result.drafted++;
          } catch { /* no key / provider down: alert goes out without a draft */ }
        }
        if (alertCandidates.size) result.alerted += await sendNegativeReviewAlerts(restaurantId, [...alertCandidates.values()], now);

        await refreshInsights(restaurantId).catch((e) =>
          log.warn({ restaurantId, error: String(e?.message || e) }, 'reviews.sweep.insights_failed'));
      } catch (e: any) {
        log.error({ restaurantId, error: String(e?.message || e) }, 'reviews.sweep.restaurant_failed');
      }
    }
    if (!opts.restaurantIds) result.escalated = await runSlaEscalations(now);
  } finally {
    await releaseJobLease(SWEEP_LEASE, lease);
  }
  log.info(result, 'reviews.sweep.done');
  return result;
}
