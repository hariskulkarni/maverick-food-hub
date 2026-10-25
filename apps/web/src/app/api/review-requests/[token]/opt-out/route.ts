/** POST /api/review-requests/<token>/opt-out { scope: 'restaurant' | 'all' } — STOP link target. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseOrJsonError } from '@/server/zod-helpers';
import { rateLimit } from '@/server/http/rate-limit';
import { isValidToken } from '@/server/reviews/acquisition';
import { optOutViaToken } from '@/server/reviews/review-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ scope: z.enum(['restaurant', 'all']) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) return Response.json({ error: 'Link not found' }, { status: 404 });
  const rl = await rateLimit(req, { name: 'review-link-optout', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const r = await optOutViaToken(token, parsed.scope);
  if (!r.ok) return Response.json({ error: r.error }, { status: 404 });
  return Response.json({ ok: true });
}
