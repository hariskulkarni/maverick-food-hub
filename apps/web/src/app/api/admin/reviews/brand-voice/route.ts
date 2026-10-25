import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { tenantAdminOrError } from '@/server/tenancy';
import { recentPostedReplies } from '@/server/reviews/store';
import { summarizeBrandVoice } from '@/server/reviews/voice';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-learn the brand voice from the last 20 posted replies now. */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const replies = await recentPostedReplies(restaurant.id);
    const summary = summarizeBrandVoice(replies);
    const now = new Date();
    await prisma.reviewResponseSettings.upsert({
      where: { restaurantId: restaurant.id },
      create: { restaurantId: restaurant.id, brandVoiceSummary: summary, brandVoiceUpdatedAt: now },
      update: { brandVoiceSummary: summary, brandVoiceUpdatedAt: now },
    });
    await auditReview('reviews.voice.refresh', restaurant.id, { after: { samples: replies.length } });
    return Response.json({ brandVoiceSummary: summary, brandVoiceUpdatedAt: now, samples: replies.length });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
