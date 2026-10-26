/**
 * POST /api/platform/jobs/novaryq-reconcile/run
 *
 * Novaryq fallbacks for missed webhooks, cron every 15 minutes, each stage under its own lease:
 *  - menu:      one signed GET /menu per linked location; linked items' availability aligned to the POS.
 *  - status:    GET /orders/:id for pushed orders quiet for 10 min while still in the kitchen funnel (QA-F4).
 *  - retention: processed webhook inbox rows older than 30 days are deleted (QA-F5).
 * No-op unless NOVARYQ_INTEGRATION_ENABLED=true.
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
import { runNovaryqStatusPoll } from '@/server/novaryq/status';
import { pruneNovaryqWebhookEvents } from '@/server/novaryq/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function stage<T extends object>(name: string, fn: () => Promise<T>) {
  try {
    const r = await withJobLease(`novaryq-reconcile:${name}`, 10 * 60_000, fn);
    return r.acquired ? { ran: true, ...r.result } : { ran: false, skipped: 'lease_held' };
  } catch (e) {
    log.error({ stage: name, err: (e as Error).message }, 'novaryq.reconcile.stage_failed');
    return { ran: false, error: true };
  }
}

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const allowed = secretMatches(headerSecret, internalSecret) || (await auth())?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  if (!novaryqFlagOn()) return Response.json({ ok: true, disabled: true });

  const reconcile = await stage('menu', () => runNovaryqReconcile());
  const status = await stage('status', () => runNovaryqStatusPoll());
  const retention = await stage('retention', () => pruneNovaryqWebhookEvents());
  return Response.json({ ok: true, reconcile, status, retention, at: new Date().toISOString() });
}
