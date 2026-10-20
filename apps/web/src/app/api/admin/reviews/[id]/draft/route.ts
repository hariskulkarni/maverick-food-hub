import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getReviewScoped, getAutoReplyConfig } from '@/server/reviews/store';
import { generateReviewReply, LlmNotConfiguredError } from '@/server/reviews/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * AI draft for a read-only (Places) review: returns text for the owner to copy
 * into Google. Deliberately persists nothing (no ReviewReply row), so it can
 * never appear as an approvable/postable draft.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const { id } = await params;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review) return new Response('Not found', { status: 404 });
    const cfg = await getAutoReplyConfig(restaurant.id);
    const gen = await generateReviewReply({
      restaurantId: restaurant.id, rating: review.rating, comment: review.comment, tone: cfg?.tonePrompt,
    });
    return Response.json({ ok: true, text: gen.text });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof LlmNotConfiguredError) return Response.json({ error: 'No LLM key configured' }, { status: 400 });
    return Response.json({ error: 'LLM generation failed' }, { status: 502 });
  }
}
