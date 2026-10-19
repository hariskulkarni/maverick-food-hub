import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getReviewScoped, saveReply, getAutoReplyConfig } from '@/server/reviews/store';
import { generateReviewReply, LlmNotConfiguredError } from '@/server/reviews/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const { id } = await params;
  const review = await getReviewScoped(restaurant.id, id);
  if (!review) return new Response('Not found', { status: 404 });
  const cfg = await getAutoReplyConfig(restaurant.id);
  let gen: Awaited<ReturnType<typeof generateReviewReply>>;
  try {
    gen = await generateReviewReply({
      restaurantId: restaurant.id, rating: review.rating, comment: review.comment, tone: cfg?.tonePrompt,
    });
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) return Response.json({ error: 'No LLM key configured' }, { status: 400 });
    return Response.json({ error: 'LLM generation failed' }, { status: 502 });
  }
  await saveReply({
    reviewId: id, restaurantId: restaurant.id, text: gen.text,
    state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model,
  });
  return Response.json({ ok: true, text: gen.text });
}
