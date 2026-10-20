/**
 * POST /api/platform/jobs/youpi-reconcile/run
 *
 * Reconciles in-flight YouPI payments against the gateway (safety net for lost
 * webhooks). Schedule every 3 minutes.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    (internalSecret && headerSecret === internalSecret) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const result = await runYoupiReconcileSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
