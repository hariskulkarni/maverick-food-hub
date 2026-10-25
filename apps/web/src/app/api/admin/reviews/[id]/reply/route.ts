import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getReviewScoped, saveReply } from '@/server/reviews/store';
import { postAndRecord, MAX_REPLY_CHARS } from '@/server/reviews/posting';
import { auditReview } from '@/server/reviews/review-audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().trim().min(1).max(MAX_REPLY_CHARS) });

/** POST: post a typed/edited reply to Google. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const { id } = await params;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review) return Response.json({ error: 'Not found' }, { status: 404 });
    const res = await postAndRecord(restaurant.id, review, parsed.text, review.reply ? 'ADMIN_EDITED' : 'MANUAL');
    await auditReview('reviews.reply.post', restaurant.id, { entityId: id, after: { status: res.status, chars: parsed.text.length } });
    return res;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

/** PUT: save the text as a DRAFT (not posted) so the team can finish it later. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const { id } = await params;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review) return Response.json({ error: 'Not found' }, { status: 404 });
    if (review.reply?.state === 'POSTED') return Response.json({ error: 'Already replied. Post an edit instead.' }, { status: 409 });
    await saveReply({ reviewId: id, restaurantId: restaurant.id, text: parsed.text, state: 'DRAFT', source: 'MANUAL' });
    await auditReview('reviews.reply.draft', restaurant.id, { entityId: id });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
