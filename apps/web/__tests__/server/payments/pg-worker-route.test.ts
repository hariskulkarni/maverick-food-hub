import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  runInbox: vi.fn(),
  runOutbox: vi.fn(),
  sweep: vi.fn(),
  inboxMetrics: vi.fn(),
  outboxMetrics: vi.fn(),
  lease: vi.fn(),
}));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/pg/inbox', () => ({ runInbox: h.runInbox, inboxMetrics: h.inboxMetrics, redactOldWebhookPayloads: async () => ({ redacted: 0 }) }));
vi.mock('@/server/pg/outbox', () => ({ runOutbox: h.runOutbox, outboxMetrics: h.outboxMetrics }));
vi.mock('@/server/pg/job-lease', () => ({ withJobLease: h.lease }));
vi.mock('@/server/jobs/youpi-reconcile-sweep', () => ({ runYoupiReconcileSweep: h.sweep }));
vi.mock('@/server/pg/attempts', () => ({ expireStaleAttempts: async () => ({ expired: 0 }), sweepUnpaidPgOrders: async () => ({ failed: 0, cancelled: 0 }) }));
vi.mock('@/server/pg/reconcile-engine', () => ({ retryUnmatchedCredits: async () => ({ tried: 0 }) }));

import { POST } from '@/app/api/platform/jobs/pg-worker/run/route';

const authed = () => new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_CRON_SECRET = 's3cret';
  h.auth.mockResolvedValue(null);
  h.lease.mockImplementation(async (_n: string, _ms: number, fn: () => Promise<unknown>) => ({ acquired: true, result: await fn() }));
  h.runInbox.mockResolvedValue({ claimed: 2, processed: 2, retried: 0, deadLettered: 0 });
  h.runOutbox.mockResolvedValue({ claimed: 1, done: 1, retried: 0, dead: 0 });
  h.sweep.mockResolvedValue({ scanned: 3 });
  h.inboxMetrics.mockResolvedValue({ pending: 4, retrying: 1, oldestPendingAgeSec: 90, deadLettered: 2 });
  h.outboxMetrics.mockResolvedValue({ backlog: 5, retrying: 0, oldestPendingAgeSec: 10, dead: 1 });
});

describe('POST /api/platform/jobs/pg-worker/run', () => {
  it('403 without the internal secret or SUPER_ADMIN; nothing runs', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 'nope' } }) as any);
    expect(res.status).toBe(403);
    expect(h.runInbox).not.toHaveBeenCalled();
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('runs inbox and outbox under their own leases, then the sweep; returns counts and metrics', async () => {
    const res = await POST(authed());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(h.lease.mock.calls.map((c) => c[0])).toEqual(['pg-worker:inbox', 'pg-worker:outbox', 'pg-worker:expiry', 'pg-worker:orders', 'pg-worker:credits', 'pg-worker:retention']);
    expect(j.inbox).toMatchObject({ ran: true, processed: 2 });
    expect(j.outbox).toMatchObject({ ran: true, done: 1 });
    expect(j.sweep).toMatchObject({ scanned: 3 });
    expect(j.metrics).toEqual({
      inboxPending: 4, inboxRetrying: 1, inboxLagSec: 90, inboxDeadLettered: 2,
      outboxBacklog: 5, outboxRetrying: 0, outboxLagSec: 10, outboxDead: 1,
    });
  });

  it('a failing stage or a held lease does not stop the others', async () => {
    h.lease.mockImplementationOnce(async () => { throw new Error('db down'); });
    h.lease.mockImplementationOnce(async () => ({ acquired: false }));
    const j = await (await POST(authed())).json();
    expect(j.inbox).toMatchObject({ ran: false, error: true });
    expect(j.outbox).toMatchObject({ ran: false, skipped: 'lease_held' });
    expect(h.sweep).toHaveBeenCalledTimes(1);
  });
});
