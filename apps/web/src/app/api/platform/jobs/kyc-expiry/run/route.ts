/**
 * POST /api/platform/jobs/kyc-expiry/run
 *
 * Flips APPROVED RiderKycDocument rows to EXPIRED when expiresOn < today,
 * takes newly-blocked riders offline, and texts expiry / renewal reminders.
 * Intended for a daily cron (e.g. 02:00 IST) or on-demand from the super-admin
 * dashboard.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/server/auth';
import { runKycExpirySweep } from '@/server/jobs/kyc-expiry-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const secretOk =
    !!internalSecret &&
    !!headerSecret &&
    headerSecret.length === internalSecret.length &&
    timingSafeEqual(Buffer.from(headerSecret), Buffer.from(internalSecret));
  const allowed =
    secretOk ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const result = await runKycExpirySweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
