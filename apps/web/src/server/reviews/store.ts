/**
 * Tenant-scoped persistence for Google reviews + replies. Every query carries
 * restaurantId; a cross-tenant id resolves to nothing (fail-closed).
 */
import { prisma } from '@/server/db';
import type { NormalizedReview, ExistingReply, ReplyMeta } from './google-business';
import type { Prisma, ReviewReplyState, ReviewReplySource } from '@prisma/client';

export async function upsertReview(
  restaurantId: string, r: NormalizedReview,
): Promise<{ id: string; isNew: boolean; edited: boolean }> {
  const existing = await prisma.googleReview.findFirst({
    where: { googleReviewId: r.googleReviewId }, select: { id: true, rating: true, comment: true },
  });
  const media = r.media && r.media.length ? (r.media as unknown as Prisma.InputJsonValue) : undefined;
  const row = await prisma.googleReview.upsert({
    where: { googleReviewId: r.googleReviewId },
    create: {
      restaurantId, googleReviewId: r.googleReviewId, reviewerName: r.reviewerName,
      rating: r.rating, comment: r.comment, reviewCreatedAt: r.reviewCreatedAt,
      source: r.source ?? 'gbp', reviewUpdatedAt: r.reviewUpdatedAt ?? null,
      ...(media ? { media } : {}),
    },
    // Edited reviews: refresh rating/comment/updateTime (+ media). createTime and source never change.
    update: {
      reviewerName: r.reviewerName, rating: r.rating, comment: r.comment,
      ...(r.reviewUpdatedAt ? { reviewUpdatedAt: r.reviewUpdatedAt } : {}),
      ...(media ? { media } : {}),
      syncedAt: new Date(),
    },
  });
  const edited = !!existing && (existing.rating !== r.rating || (existing.comment ?? null) !== (r.comment ?? null));
  return { id: row.id, isNew: !existing, edited };
}

/**
 * Mirror a reply that already exists on Google. No LLM call, nothing posted.
 *  - no local row, or a local row that is not POSTED → store Google's text as POSTED/MANUAL;
 *  - a local POSTED row → refresh only the moderation fields (Google may approve/reject later).
 * Returns true when it created/overwrote the local reply.
 */
export async function syncGoogleReply(reviewId: string, restaurantId: string, reply: ExistingReply): Promise<boolean> {
  const current = await prisma.reviewReply.findUnique({ where: { reviewId }, select: { state: true } });
  const meta = {
    moderationState: reply.moderationState, policyViolation: reply.policyViolation, reviewReplyUrl: reply.reviewReplyUrl,
  };
  if (current?.state === 'POSTED') {
    await prisma.reviewReply.update({ where: { reviewId }, data: meta });
    return false;
  }
  const data = {
    restaurantId, text: reply.comment, state: 'POSTED' as const, source: 'MANUAL' as const,
    postedAt: reply.updateTime ?? new Date(), error: null, holdReason: null, llmProvider: null, llmModel: null, ...meta,
  };
  await prisma.reviewReply.upsert({ where: { reviewId }, create: { reviewId, ...data }, update: data });
  return true;
}

export async function hasReply(reviewId: string): Promise<boolean> {
  const r = await prisma.reviewReply.findUnique({ where: { reviewId }, select: { id: true } });
  return !!r;
}

export async function getAutoReplyConfig(restaurantId: string) {
  return prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId } });
}

/** Response settings row; defaults (schema defaults) when the restaurant never saved any. */
export async function getResponseSettings(restaurantId: string) {
  const row = await prisma.reviewResponseSettings.findUnique({ where: { restaurantId } });
  return row ?? { ...RESPONSE_SETTINGS_DEFAULTS, restaurantId, createdAt: null as Date | null };
}

export const RESPONSE_SETTINGS_DEFAULTS = {
  skipKeywords: ['food poisoning', 'allergy', 'allergic', 'refund', 'legal', 'lawyer', 'sick', 'hospital', 'hair in'],
  brandVoiceSummary: null as string | null,
  brandVoiceUpdatedAt: null as Date | null,
  alertEnabled: true, alertMaxRating: 2, alertSms: false, alertWhatsapp: false,
  slaHours: 24, escalationEmail: null as string | null, escalationPhone: null as string | null,
  digestEnabled: false, digestSms: false, digestWhatsapp: false, digestLastSentAt: null as Date | null,
  googleAverageRating: null as number | null, googleTotalReviewCount: null as number | null, googleStatsAt: null as Date | null,
};

export async function saveGoogleStats(restaurantId: string, stats: { averageRating: number | null; totalReviewCount: number | null }) {
  if (stats.averageRating == null && stats.totalReviewCount == null) return;
  const data = { googleAverageRating: stats.averageRating, googleTotalReviewCount: stats.totalReviewCount, googleStatsAt: new Date() };
  await prisma.reviewResponseSettings.upsert({ where: { restaurantId }, create: { restaurantId, ...data }, update: data });
}

/** Text of the restaurant's most recent posted replies (brand-voice input). */
export async function recentPostedReplies(restaurantId: string, take = 20): Promise<string[]> {
  const rows = await prisma.reviewReply.findMany({
    where: { restaurantId, state: 'POSTED', text: { not: '' } },
    orderBy: { postedAt: 'desc' }, take, select: { text: true },
  });
  return rows.map((r) => r.text);
}

export async function saveReply(args: {
  reviewId: string; restaurantId: string; text: string; state: ReviewReplyState; source: ReviewReplySource;
  llmProvider?: string; llmModel?: string; postedAt?: Date | null; error?: string | null;
  holdReason?: string | null; meta?: ReplyMeta | null;
}): Promise<void> {
  const data = {
    restaurantId: args.restaurantId, text: args.text, state: args.state, source: args.source,
    llmProvider: args.llmProvider ?? null, llmModel: args.llmModel ?? null,
    postedAt: args.postedAt ?? null, error: args.error ?? null, holdReason: args.holdReason ?? null,
    moderationState: args.meta?.moderationState ?? null,
    policyViolation: args.meta?.policyViolation ?? null,
    reviewReplyUrl: args.meta?.reviewReplyUrl ?? null,
  };
  await prisma.reviewReply.upsert({
    where: { reviewId: args.reviewId },
    create: { reviewId: args.reviewId, ...data },
    update: data,
  });
}

export const ADMIN_PAGE_SIZE = 25;

/** Unreplied (no POSTED reply) Business Profile reviews older than the SLA. */
export function overdueWhere(slaHours: number, now = new Date()): Prisma.GoogleReviewWhereInput {
  return {
    source: 'gbp',
    reviewCreatedAt: { lt: new Date(now.getTime() - slaHours * 3_600_000) },
    OR: [{ reply: { is: null } }, { reply: { state: { not: 'POSTED' } } }],
  };
}

export async function listReviewsForAdmin(
  restaurantId: string,
  filter?: {
    rating?: number; state?: ReviewReplyState; q?: string; overdueSlaHours?: number;
    cursor?: string; take?: number; id?: string;
  },
): Promise<{ items: Awaited<ReturnType<typeof findAdminRows>>; nextCursor: string | null }> {
  const take = Math.min(100, Math.max(1, filter?.take ?? ADMIN_PAGE_SIZE));
  const q = filter?.q?.trim().slice(0, 100);
  const and: Prisma.GoogleReviewWhereInput[] = [];
  if (q) and.push({ OR: [{ comment: { contains: q, mode: 'insensitive' } }, { reviewerName: { contains: q, mode: 'insensitive' } }] });
  if (filter?.overdueSlaHours) and.push(overdueWhere(filter.overdueSlaHours));
  const where: Prisma.GoogleReviewWhereInput = {
    restaurantId,
    ...(filter?.id ? { id: filter.id } : {}),
    ...(filter?.rating ? { rating: filter.rating } : {}),
    ...(filter?.state ? { reply: { state: filter.state } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
  const rows = await findAdminRows(where, take + 1, filter?.cursor);
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

function findAdminRows(where: Prisma.GoogleReviewWhereInput, take: number, cursor?: string) {
  return prisma.googleReview.findMany({
    where,
    include: { reply: true },
    orderBy: [{ reviewCreatedAt: 'desc' }, { id: 'desc' }],
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
