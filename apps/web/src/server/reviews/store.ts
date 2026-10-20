/**
 * Tenant-scoped persistence for Google reviews + replies. Every query carries
 * restaurantId; a cross-tenant id resolves to nothing (fail-closed).
 */
import { prisma } from '@/server/db';
import type { NormalizedReview } from './google-business';
import type { ReviewReplyState, ReviewReplySource } from '@prisma/client';

export async function upsertReview(restaurantId: string, r: NormalizedReview): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.googleReview.findFirst({ where: { googleReviewId: r.googleReviewId }, select: { id: true } });
  const row = await prisma.googleReview.upsert({
    where: { googleReviewId: r.googleReviewId },
    create: {
      restaurantId, googleReviewId: r.googleReviewId, reviewerName: r.reviewerName,
      rating: r.rating, comment: r.comment, reviewCreatedAt: r.reviewCreatedAt,
      source: r.source ?? 'gbp',
    },
    update: { reviewerName: r.reviewerName, rating: r.rating, comment: r.comment },
  });
  return { id: row.id, isNew: !existing };
}

export async function hasReply(reviewId: string): Promise<boolean> {
  const r = await prisma.reviewReply.findUnique({ where: { reviewId }, select: { id: true } });
  return !!r;
}

export async function getAutoReplyConfig(restaurantId: string) {
  return prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId } });
}

export async function saveReply(args: {
  reviewId: string; restaurantId: string; text: string; state: ReviewReplyState; source: ReviewReplySource;
  llmProvider?: string; llmModel?: string; postedAt?: Date | null; error?: string | null;
}): Promise<void> {
  const data = {
    restaurantId: args.restaurantId, text: args.text, state: args.state, source: args.source,
    llmProvider: args.llmProvider ?? null, llmModel: args.llmModel ?? null,
    postedAt: args.postedAt ?? null, error: args.error ?? null,
  };
  await prisma.reviewReply.upsert({
    where: { reviewId: args.reviewId },
    create: { reviewId: args.reviewId, ...data },
    update: data,
  });
}

export async function listReviewsForAdmin(
  restaurantId: string, filter?: { rating?: number; state?: ReviewReplyState },
) {
  return prisma.googleReview.findMany({
    where: {
      restaurantId,
      ...(filter?.rating ? { rating: filter.rating } : {}),
      ...(filter?.state ? { reply: { state: filter.state } } : {}),
    },
    include: { reply: true },
    orderBy: { reviewCreatedAt: 'desc' },
    take: 200,
  });
}

export async function getReviewScoped(restaurantId: string, reviewId: string) {
  return prisma.googleReview.findFirst({ where: { id: reviewId, restaurantId }, include: { reply: true } });
}

// ---- Tier-1 Google Places link (stored on the 1-per-restaurant ReviewAutoReplyConfig row) ----

export async function getPlacesLink(restaurantId: string): Promise<{ placeId: string; name: string } | null> {
  const c = await prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId } });
  return c?.googlePlaceId ? { placeId: c.googlePlaceId, name: c.googlePlaceName ?? '' } : null;
}

export async function setPlacesLink(restaurantId: string, link: { placeId: string; name: string }): Promise<void> {
  const data = { googlePlaceId: link.placeId, googlePlaceName: link.name, googlePlaceConnectedAt: new Date() };
  await prisma.reviewAutoReplyConfig.upsert({
    where: { restaurantId }, create: { restaurantId, ...data }, update: data,
  });
}

/** Unlink and remove this tenant's places-sourced reviews (replies cascade) so nothing stale lingers. */
export async function clearPlacesLink(restaurantId: string): Promise<void> {
  await prisma.googleReview.deleteMany({ where: { restaurantId, source: 'places' } });
  await prisma.reviewAutoReplyConfig.upsert({
    where: { restaurantId },
    create: { restaurantId },
    update: { googlePlaceId: null, googlePlaceName: null, googlePlaceConnectedAt: null },
  });
}
