/**
 * POST /api/platform/jobs/rider-shift-missed/run
 *
 * Flips BOOKED RiderShifts whose start time (plus a short grace window) has
 * passed without the rider starting them to MISSED. Intended for a periodic
 * cron (every 15-30 min) or on-demand from the super-admin rider-shifts page.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runRiderShiftMissedSweep } from '@/server/jobs/rider-shift-missed-sweep';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    (internalSecret && headerSecret === internalSecret) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const result = await runRiderShiftMissedSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
