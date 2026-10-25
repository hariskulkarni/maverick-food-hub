/**
 * POST /api/rider/web/application/verify — rider portal, applicant path.
 *
 * Verifies the phone_verify code from ./request-otp and returns the rider
 * application's status. No session or cookie is created.
 *
 * Body: { phone, code }
 * 200: { status, createdAt, reviewedAt, rejectedReason }
 * 401: { error: 'invalid_code' }   404: { error: 'no_application' }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { verifyOtp } from '@/server/otp';
import { rateLimit } from '@/server/http/rate-limit';
import { riderCookieRequestAllowed } from '@/server/rider-auth';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ phone: z.string().trim().min(8).max(20), code: z.string().trim().min(4).max(8) });

export async function POST(req: NextRequest) {
  if (!riderCookieRequestAllowed(req.headers)) {
    return Response.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }
  const rl = await rateLimit(req, { name: 'rider-application-verify', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const { phone, code } = parsed;

  const ok = await verifyOtp({ phone, code, purpose: 'phone_verify' });
  if (!ok) return Response.json({ error: 'invalid_code' }, { status: 401 });

  const app = await prisma.riderApplication.findUnique({
    where: { phone },
    select: { status: true, createdAt: true, reviewedAt: true, rejectedReason: true },
  });
  if (!app) return Response.json({ error: 'no_application' }, { status: 404 });
  return Response.json(
    {
      status: app.status,
      createdAt: app.createdAt.toISOString(),
      reviewedAt: app.reviewedAt?.toISOString() ?? null,
      rejectedReason: app.status === 'REJECTED' ? app.rejectedReason ?? null : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
