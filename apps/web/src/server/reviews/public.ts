/**
 * Public (storefront) review projection.
 *
 * In-app reviews go through the SAME central redaction as every other surface
 * (`visibleForRole`). The public view is the ADMIN projection narrowed further:
 * only the overall rating, and the comment only when the customer opted in
 * (`shareCommentWithRider` is the existing comment opt-in flag). Tags, images,
 * food/delivery ratings, order ids, customer ids and contact details are never
 * emitted. Only moderationStatus === PUBLISHED rows are ever returned.
 */
import { prisma } from '@/server/db';
import { visibleForRole, type FeedbackLite } from '@/server/feedback';

export interface PublicReview {
  id: string;
  source: 'app' | 'google';
  rating: number;
  comment: string | null;
  author: string;
  date: string;
  reply: { text: string; at: string | null } | null;
}

export interface PublicReviewsPage {
  aggregate: { average: number | null; count: number; inAppCount: number; googleCount: number };
  reviews: PublicReview[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const MAX_PAGE_SIZE = 50;

export function firstName(name: string | null | undefined, fallback: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first.slice(0, 24) : fallback;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export function toPublicInApp(row: any): PublicReview | null {
  if (row.moderationStatus !== 'PUBLISHED') return null;
  const v = visibleForRole(row as FeedbackLite, 'ADMIN');
  if (v.overallRating == null) return null;
  const comment = row.shareCommentWithRider && v.visibleFields.includes('comment') ? v.comment : null;
  return {
    id: `app:${row.id}`,
    source: 'app',
    rating: v.overallRating,
    comment: comment || null,
    author: firstName(row.customer?.name, 'Customer'),
    date: iso(v.createdAt)!,
    reply: row.reply ? { text: row.reply, at: iso(row.replyAt) } : null,
  };
}

export function toPublicGoogle(row: any): PublicReview {
  const posted = row.reply && row.reply.state === 'POSTED';
  return {
    id: `google:${row.id}`,
    source: 'google',
    rating: row.rating,
    comment: row.comment || null,
    author: firstName(row.reviewerName, 'Google user'),
    date: iso(row.reviewCreatedAt)!,
    reply: posted ? { text: row.reply.text, at: iso(row.reply.postedAt) } : null,
  };
}

export async function loadPublicReviews(
  restaurantId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<PublicReviewsPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? 10) || 10));
  const take = page * pageSize + 1;

  const appWhere = {
    moderationStatus: 'PUBLISHED',
    overallRating: { not: null },
    order: { branch: { restaurantId } },
  };
  const [appRows, googleRows, appAgg, googleAgg] = await Promise.all([
    (prisma as any).orderFeedback.findMany({
      where: appWhere,
      select: {
        id: true, orderId: true, customerId: true, foodRating: true, deliveryRating: true, overallRating: true,
        comment: true, issueTags: true, imageUrl: true, shareCommentWithRider: true, windowEndsAt: true,
        createdAt: true, editedAt: true, moderationStatus: true, reply: true, replyAt: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.googleReview.findMany({
      where: { restaurantId },
      select: { id: true, reviewerName: true, rating: true, comment: true, reviewCreatedAt: true, reply: { select: { state: true, text: true, postedAt: true } } },
      orderBy: { reviewCreatedAt: 'desc' },
      take,
    }),
    (prisma as any).orderFeedback.aggregate({ where: appWhere, _avg: { overallRating: true }, _count: { _all: true } }),
    prisma.googleReview.aggregate({ where: { restaurantId }, _avg: { rating: true }, _count: { _all: true } }),
  ]);

  const merged: PublicReview[] = [
    ...(appRows as any[]).map(toPublicInApp).filter((r): r is PublicReview => r !== null),
    ...(googleRows as any[]).map(toPublicGoogle),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const start = (page - 1) * pageSize;
  const inAppCount = appAgg._count._all as number;
  const googleCount = googleAgg._count._all as number;
  const total = inAppCount + googleCount;
  const sum = (appAgg._avg.overallRating ?? 0) * inAppCount + (googleAgg._avg.rating ?? 0) * googleCount;
  return {
    aggregate: { average: total ? Math.round((sum / total) * 10) / 10 : null, count: total, inAppCount, googleCount },
    reviews: merged.slice(start, start + pageSize),
    page,
    pageSize,
    hasMore: merged.length > start + pageSize,
  };
}
