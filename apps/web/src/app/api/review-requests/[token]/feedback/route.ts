/**
 * POST /api/review-requests/<token>/feedback — star rating + optional comment
 * from the tracked feedback page. The token is the bearer credential (it was
 * sent only to the order's customer). Response always carries the same
 * googleUrl regardless of rating (no review gating).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseOrJsonError, optionalString, optionalPhone } from '@/server/zod-helpers';
import { rateLimit } from '@/server/http/rate-limit';
import { isValidToken } from '@/server/reviews/acquisition';
import { submitFeedbackViaLink } from '@/server/reviews/review-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  comment: optionalString(500),
  contactName: optionalString(80),
  contactPhone: optionalPhone,
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) return Response.json({ error: 'Link not found' }, { status: 404 });
  const rl = await rateLimit(req, { name: 'review-link-feedback', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const r = await submitFeedbackViaLink(token, parsed);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, ticketOpened: r.ticketOpened, googleUrl: r.googleUrl }, { status: 201 });
}
