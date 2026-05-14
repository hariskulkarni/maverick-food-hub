/**
 * POST /api/platform/rider-heartbeat/sweep
 *
 * Flip stale-heartbeat riders to offline. Run from a 1-minute cron or the
 * platform live-ops dashboard.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runHeartbeatSweep } from '@/server/rider-heartbeat';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    (internalSecret && headerSecret === internalSecret) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const result = await runHeartbeatSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
