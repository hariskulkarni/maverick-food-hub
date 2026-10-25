/**
 * One place that turns a review into an AI reply draft: owner tone notes +
 * learned brand voice + private order context (if matched) + Google's
 * rejection reason (when redrafting), then the public-reply safety filter.
 */
import { generateReviewReply } from './llm';
import { getOrderContext, privateContextText, type OrderContext } from './order-match';
import { checkReplySafety, summarizeIssues, type SafetyIssue } from '@/lib/review-reply-safety';

export type DraftInput = {
  id: string; rating: number; comment: string | null;
  matchedOrderId?: string | null; matchConfidence?: number | null;
  reply?: { moderationState?: string | null; policyViolation?: string | null } | null;
};

export type Draft = {
  text: string; provider: string; model: string;
  issues: SafetyIssue[]; holdReason: string | null;
};

export function isRejected(reply: DraftInput['reply']): boolean {
  return !!reply && (/reject/i.test(reply.moderationState ?? '') || !!reply.policyViolation);
}

/** Order identifiers for a review's matched order (empty when none). */
export async function privateTermsFor(restaurantId: string, review: Pick<DraftInput, 'matchedOrderId' | 'matchConfidence'>): Promise<{ ctx: OrderContext | null; terms: string[] }> {
  if (!review.matchedOrderId) return { ctx: null, terms: [] };
  const ctx = await getOrderContext(restaurantId, review.matchedOrderId, review.matchConfidence ?? null);
  return { ctx, terms: ctx?.privateTerms ?? [] };
}

export async function draftReply(
  restaurantId: string,
  review: DraftInput,
  opts: { tone?: string | null; voice?: string | null },
): Promise<Draft> {
  const { ctx, terms } = await privateTermsFor(restaurantId, review);
  const gen = await generateReviewReply({
    restaurantId, rating: review.rating, comment: review.comment, tone: opts.tone ?? null,
    voice: opts.voice ?? null,
    privateContext: privateContextText(ctx),
    rejectionReason: isRejected(review.reply) ? (review.reply?.policyViolation || 'policy violation') : null,
  });
  const issues = checkReplySafety(gen.text, terms);
  return {
    text: gen.text, provider: gen.provider, model: gen.model, issues,
    holdReason: issues.length ? `Safety filter: ${summarizeIssues(issues)}` : null,
  };
}
