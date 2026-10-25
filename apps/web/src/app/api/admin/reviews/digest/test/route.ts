import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getResponseSettings } from '@/server/reviews/store';
import { sendDigest } from '@/server/jobs/review-digest';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Send test digest now": this restaurant's last-7-days digest, regardless of the toggle. */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const s = await getResponseSettings(restaurant.id);
    const out = await sendDigest(restaurant.id, { channels: { sms: s.digestSms, whatsapp: s.digestWhatsapp } });
    await auditReview('reviews.digest.test', restaurant.id, { after: out });
    if (out.recipients === 0) return Response.json({ error: 'No owner or admin email on file for this restaurant' }, { status: 409 });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
