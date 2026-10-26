import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  lease: vi.fn(),
  webhooks: vi.fn(),
  push: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/pg/job-lease', () => ({ withJobLease: h.lease }));
vi.mock('@/server/novaryq/webhook', () => ({ runNovaryqWebhookWorker: h.webhooks }));
vi.mock('@/server/novaryq/push', () => ({ runNovaryqPushWorker: h.push }));
vi.mock('@/server/novaryq/menu', () => ({ runNovaryqReconcile: h.reconcile }));

import { POST } from '@/app/api/platform/jobs/novaryq-worker/run/route';

const call = (secret = 's3cret', qs = '') =>
  POST(Object.assign(new Request(`http://x/api/platform/jobs/novaryq-worker/run${qs}`, { method: 'POST', headers: { 'x-internal-secret': secret } }), { nextUrl: new URL(`http://x/api/platform/jobs/novaryq-worker/run${qs}`) }) as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INTERNAL_CRON_SECRET', 's3cret');
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.auth.mockResolvedValue(null);
  h.lease.mockImplementation(async (_n: string, _ms: number, fn: () => Promise<unknown>) => ({ acquired: true, result: await fn() }));
  h.webhooks.mockResolvedValue({ claimed: 1, done: 1, retried: 0, dead: 0 });
  h.push.mockResolvedValue({ claimed: 2, sent: 2, cancelled: 0, retried: 0, failed: 0, dead: 0 });
  h.reconcile.mockResolvedValue({ restaurants: 1, changed: 0, errors: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/platform/jobs/novaryq-worker/run', () => {
  it('403 without the internal secret (or with a wrong one); nothing runs', async () => {
    expect((await call('nope')).status).toBe(403);
    expect((await call('')).status).toBe(403);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('runs webhook inbox then push outbox under their own leases', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(h.lease.mock.calls.map((c) => c[0])).toEqual(['novaryq-worker:webhooks', 'novaryq-worker:push']);
    expect(j.push).toMatchObject({ ran: true, sent: 2 });
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('the reconcile job runs the menu/availability reconcile under its own lease', async () => {
    const { POST: reconcile } = await import('@/app/api/platform/jobs/novaryq-reconcile/run/route');
    expect((await reconcile(new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 'bad' } }) as any)).status).toBe(403);
    const j = await (await reconcile(new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }) as any)).json();
    expect(h.lease.mock.calls.map((c) => c[0])).toEqual(['novaryq-reconcile']);
    expect(j).toMatchObject({ ok: true, reconcile: { ran: true, restaurants: 1 } });
  });

  it('feature flag off → no-op', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    const j = await (await call()).json();
    expect(j).toMatchObject({ ok: true, disabled: true });
    expect(h.push).not.toHaveBeenCalled();
  });

  it('a failing stage does not stop the next one', async () => {
    h.webhooks.mockRejectedValue(new Error('db'));
    const j = await (await call()).json();
    expect(j.webhooks).toMatchObject({ ran: false, error: true });
    expect(j.push).toMatchObject({ ran: true });
  });

  it('both jobs are POST-only and compare the secret in constant time (T-17)', () => {
    for (const j of ['novaryq-worker', 'novaryq-reconcile']) {
      const src = readFileSync(`src/app/api/platform/jobs/${j}/run/route.ts`, 'utf8');
      expect(src).not.toMatch(/export\s+(const|async function)\s+GET/);
      expect(src).toContain('secretMatches(headerSecret, internalSecret)');
    }
  });
});
