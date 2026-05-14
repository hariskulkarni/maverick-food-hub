/**
 * POST /api/platform/escalations/scan
 * Triggers the stuck-order detector. Designed to be called from:
 *   - a 1-minute server-side cron
 *   - the live-ops dashboard's "Scan now" button
 *   - or an external Uptime-Kuma-style monitor that pings this endpoint
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { runEscalationScan } from '@/server/escalations';
import { auth } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed = (internalSecret && headerSecret === internalSecret) || session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const result = await runEscalationScan();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST; // convenience for HEAD/GET-only cron pingers
