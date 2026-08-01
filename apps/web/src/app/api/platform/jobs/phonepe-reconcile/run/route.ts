/**
 * POST /api/platform/jobs/phonepe-reconcile/run
 *
 * Reconciles in-flight PhonePe payments and refunds against the gateway, and
 * retires orders whose checkout expired unpaid. This is the safety net for lost
 * webhooks — schedule it every 5 minutes.
 *
 *   *\/5 * * * * curl -fsS -X POST https://<domain>/api/platform/jobs/phonepe-reconcile/run \
 *                  -H "x-internal-secret: $INTERNAL_CRON_SECRET"
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runPhonePeReconcileSweep } from '@/server/jobs/phonepe-reconcile-sweep';

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

  const result = await runPhonePeReconcileSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
