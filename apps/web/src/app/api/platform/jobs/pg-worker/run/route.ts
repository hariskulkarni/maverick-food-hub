/**
 * POST /api/platform/jobs/pg-worker/run
 *
 * One tick of the Flavrly PG worker: inbound webhook inbox, transactional
 * outbox, then the gateway-status reconcile sweep. Each stage runs under its
 * own PgJobLease so overlapping ticks (cron + manual, two app instances) never
 * run the same stage concurrently; row-level leases inside inbox/outbox make
 * even that safe. A failing stage does not stop the others. Schedule every
 * minute.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET
 * (same as /api/platform/jobs/youpi-reconcile/run).
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/server/auth';
import { log } from '@/server/log';
import { inboxMetrics, redactOldWebhookPayloads, runInbox } from '@/server/pg/inbox';
import { outboxMetrics, runOutbox } from '@/server/pg/outbox';
import { withJobLease } from '@/server/pg/job-lease';
import { expireStaleAttempts } from '@/server/pg/attempts';
import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_LEASE_MS = 2 * 60_000;

async function stage<T>(name: string, fn: () => Promise<T>) {
  try {
    const r = await withJobLease(`pg-worker:${name}`, STAGE_LEASE_MS, fn);
    return r.acquired ? { ran: true, ...r.result } : { ran: false, skipped: 'lease_held' };
  } catch (e) {
    log.error({ stage: name, err: (e as Error).message }, 'pg.worker.stage_failed');
    return { ran: false, error: true };
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    (internalSecret && headerSecret && safeEqual(headerSecret, internalSecret)) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const inbox = await stage('inbox', () => runInbox());
  const outbox = await stage('outbox', () => runOutbox());
  // Unknown-outcome resolution + expiry of never-paid sessions (never expires OBSERVED/REVIEW_REQUIRED).
  const expiry = await stage('expiry', () => expireStaleAttempts());
  const retention = await stage('retention', () => redactOldWebhookPayloads());
  // The sweep takes its own 'youpi-reconcile-sweep' lease (shared with the legacy cron route).
  let sweep: Record<string, unknown>;
  try {
    sweep = { ...(await runYoupiReconcileSweep()) };
  } catch (e) {
    log.error({ stage: 'sweep', err: (e as Error).message }, 'pg.worker.stage_failed');
    sweep = { error: true };
  }

  let metrics: Record<string, unknown> | null = null;
  try {
    const [inboxM, outboxM] = await Promise.all([inboxMetrics(), outboxMetrics()]);
    metrics = {
      inboxPending: inboxM.pending,
      inboxRetrying: inboxM.retrying,
      inboxLagSec: inboxM.oldestPendingAgeSec,
      inboxDeadLettered: inboxM.deadLettered,
      outboxBacklog: outboxM.backlog,
      outboxRetrying: outboxM.retrying,
      outboxLagSec: outboxM.oldestPendingAgeSec,
      outboxDead: outboxM.dead,
    };
    log.info(metrics, 'pg.worker.metrics');
  } catch (e) {
    log.error({ err: (e as Error).message }, 'pg.worker.metrics_failed');
  }

  return Response.json({ ok: true, inbox, outbox, expiry, retention, sweep, metrics, at: new Date().toISOString() });
}

