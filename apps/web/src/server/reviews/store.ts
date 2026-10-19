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
    },
    update: { reviewerName: r.reviewerName, rating: r.rating, comment: r.comment },
  });
  return { id: row.id, isNew: !existing };
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
