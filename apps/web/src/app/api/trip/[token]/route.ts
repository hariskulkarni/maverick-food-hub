/**
 * GET /api/trip/[token] — public, token-scoped live-trip view polled by the
 * /trip/<token> page. Returns no customer PII (see server/trip-share.ts).
 */
import { NextRequest } from 'next/server';
import { loadTripShareView } from '@/server/trip-share';
import { rateLimit } from '@/server/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await rateLimit(req, { name: 'trip-share', limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const { token } = await params;
  const view = await loadTripShareView(token);
  return Response.json(view, {
    status: view.state === 'not_found' ? 404 : 200,
    headers: { 'Cache-Control': 'no-store' }
  });
}
