/**
 * GET /rv/<token> — tracked short link carried in every review ask.
 * Records the first click (link-preview bots excluded) and redirects to the
 * Flavrly feedback page, where the Google review button is shown at every rating.
 */
import { NextRequest } from 'next/server';
import { isPreviewBot, recordClick } from '@/server/reviews/review-link';
import { isValidToken } from '@/server/reviews/acquisition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Relative Location: behind `next start` req.nextUrl reports the socket address,
// so an absolute URL built from it would point customers at 127.0.0.1.
const go = (path: string) => new Response(null, { status: 302, headers: { Location: path, 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) return go('/');
  if (!isPreviewBot(req.headers.get('user-agent'))) await recordClick(token).catch(() => null);
  return go(`/feedback/${encodeURIComponent(token)}`);
}
