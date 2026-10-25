/** POST /api/review-requests/<token>/google — counts a Google review button click (first only). */
import { NextRequest } from 'next/server';
import { rateLimit } from '@/server/http/rate-limit';
import { isValidToken } from '@/server/reviews/acquisition';
import { recordGoogleClick } from '@/server/reviews/review-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) return Response.json({ error: 'Link not found' }, { status: 404 });
  const rl = await rateLimit(req, { name: 'review-link-google', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const counted = await recordGoogleClick(token);
  return Response.json({ ok: true, counted });
}
