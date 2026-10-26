/**
 * POST /api/platform/jobs/novaryq-reconcile/run
 *
 * Novaryq menu/availability reconcile — the fallback for missed 86 webhooks.
 * For every restaurant with a linked Novaryq location: one signed GET /menu per
 * location, linked Flavrly items' availability aligned to the POS. Cron every
 * 15 minutes. No-op unless NOVARYQ_INTEGRATION_ENABLED=true.
 *
 * Auth: x-internal-secret matching INTERNAL_CRON_SECRET (constant time) OR a SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { log } from '@/server/log';
import { secretMatches } from '@/server/http/secret-compare';
import { withJobLease } from '@/server/pg/job-lease';
import { novaryqFlagOn } from '@/server/novaryq/config';
import { runNovaryqReconcile } from '@/server/novaryq/menu';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const allowed = secretMatches(headerSecret, internalSecret) || (await auth())?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  if (!novaryqFlagOn()) return Response.json({ ok: true, disabled: true });

  let reconcile: Record<string, unknown>;
  try {
    const r = await withJobLease('novaryq-reconcile', 10 * 60_000, () => runNovaryqReconcile());
    reconcile = r.acquired ? { ran: true, ...r.result } : { ran: false, skipped: 'lease_held' };
  } catch (e) {
    log.error({ err: (e as Error).message }, 'novaryq.reconcile.job_failed');
    reconcile = { ran: false, error: true };
  }
  return Response.json({ ok: true, reconcile, at: new Date().toISOString() });
}
