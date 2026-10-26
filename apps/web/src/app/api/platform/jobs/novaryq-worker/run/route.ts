/**
 * POST /api/platform/jobs/novaryq-worker/run
 *
 * One tick of the Novaryq POS worker: the inbound webhook inbox (status + 86
 * events), then the order push/cancel outbox. (The menu/availability reconcile is
 * its own job: /api/platform/jobs/novaryq-reconcile/run.) Each stage runs under
 * its own PgJobLease; row-level leases inside make even overlapping ticks safe. A failing stage does not stop the others.
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
import { runNovaryqWebhookWorker } from '@/server/novaryq/webhook';
import { runNovaryqPushWorker } from '@/server/novaryq/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_LEASE_MS = 2 * 60_000;

async function stage<T extends object>(name: string, fn: () => Promise<T>) {
  try {
    const r = await withJobLease(`novaryq-worker:${name}`, STAGE_LEASE_MS, fn);
    return r.acquired ? { ran: true, ...r.result } : { ran: false, skipped: 'lease_held' };
  } catch (e) {
    log.error({ stage: name, err: (e as Error).message }, 'novaryq.worker.stage_failed');
    return { ran: false, error: true };
  }
}

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const allowed = secretMatches(headerSecret, internalSecret) || (await auth())?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  if (!novaryqFlagOn()) return Response.json({ ok: true, disabled: true });

  const webhooks = await stage('webhooks', () => runNovaryqWebhookWorker());
  const push = await stage('push', () => runNovaryqPushWorker());
  return Response.json({ ok: true, webhooks, push, at: new Date().toISOString() });
}
