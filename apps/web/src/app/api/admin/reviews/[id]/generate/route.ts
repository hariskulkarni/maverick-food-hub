import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { getReviewScoped, saveReply, getAutoReplyConfig, getResponseSettings } from '@/server/reviews/store';
import { LlmNotConfiguredError } from '@/server/reviews/llm';
import { draftReply, isRejected } from '@/server/reviews/drafting';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * (Re)generate an approval draft. When Google rejected the current reply this
 * is the one-tap "Redraft": the rejection reason is fed to the model.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const { id } = await params;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review) return Response.json({ error: 'Not found' }, { status: 404 });
    const [cfg, settings] = await Promise.all([getAutoReplyConfig(restaurant.id), getResponseSettings(restaurant.id)]);
    let gen;
    try {
      gen = await draftReply(restaurant.id, review, { tone: cfg?.tonePrompt, voice: settings.brandVoiceSummary });
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) return Response.json({ error: 'No LLM key configured' }, { status: 400 });
      return Response.json({ error: 'LLM generation failed' }, { status: 502 });
    }
    const redraft = isRejected(review.reply);
    await saveReply({
      reviewId: id, restaurantId: restaurant.id, text: gen.text,
      state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model,
      holdReason: gen.holdReason ?? (redraft ? `Redraft after Google rejected the previous reply: ${review.reply?.policyViolation ?? 'policy violation'}` : null),
    });
    await auditReview('reviews.reply.generate', restaurant.id, { entityId: id, after: { redraft, flagged: gen.issues.length > 0 } });
    return Response.json({ ok: true, text: gen.text, issues: gen.issues });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
