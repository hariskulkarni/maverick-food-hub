/**
 * The HTTP recorder against a real node:http server: every request is timed
 * and aggregated by route template, gets an x-request-id, runs inside the
 * request context, and job-route calls are recorded as job runs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const h = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'run1' })),
  update: vi.fn(async () => ({})),
}));
vi.mock('@/server/db', () => ({ prisma: { obsJobRun: { create: h.create, update: h.update } } }));

import { installHttpRecorder } from '@/server/observability/http-recorder';
import { drain } from '@/server/observability/aggregator';
import { currentRequest } from '@/server/observability/request-context';
import { setRouteTemplatesForTest } from '@/server/observability/routes';

let server: http.Server;
let base = '';
let seenCtx: ReturnType<typeof currentRequest> = undefined;

beforeAll(async () => {
  setRouteTemplatesForTest(['/api/orders/[id]/route', '/api/platform/jobs/kyc-expiry/run/route']);
  installHttpRecorder();
  installHttpRecorder(); // idempotent
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/orders/')) {
      seenCtx = currentRequest();
      setTimeout(() => {
        res.statusCode = req.url!.endsWith('boom') ? 500 : 200;
        res.end('{}');
      }, 15);
      return;
    }
    if (req.url?.startsWith('/api/platform/jobs/')) {
      res.statusCode = req.headers['x-internal-secret'] === 'ok' ? 200 : 403;
      res.setHeader('content-type', 'application/json');
      res.end(res.statusCode === 200 ? JSON.stringify({ ok: true, expired: 2 }) : JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  setRouteTemplatesForTest(null);
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  drain();
  vi.clearAllMocks();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('http recorder', () => {
  it('aggregates by route template with status + latency, sets x-request-id, exposes context', async () => {
    const r1 = await fetch(`${base}/api/orders/cm1abcdefghijklmnopqrstu`);
    await fetch(`${base}/api/orders/cm2abcdefghijklmnopqrstu/boom`);
    await fetch(`${base}/api/orders/cm3abcdefghijklmnopqrstu`, { headers: { 'x-request-id': 'my-trace-1234' } });
    await fetch(`${base}/_next/static/x.js`); // ignored
    await settle();
    expect(r1.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(seenCtx?.requestId).toBe('my-trace-1234');
    expect(seenCtx?.route).toBe('/api/orders/[id]');
    const { req } = drain();
    const ok = req.find((b) => b.route === '/api/orders/[id]')!;
    expect(ok.count).toBe(2);
    expect(ok.durMaxMs).toBeGreaterThanOrEqual(10);
    const boom = req.find((b) => b.route !== '/api/orders/[id]')!;
    expect(boom.s5xx).toBe(1);
    expect(req.some((b) => b.route.includes('_next'))).toBe(false);
  });

  it('records job runs (start + finish with summary / error) for /api/platform/jobs/<name>/run', async () => {
    await fetch(`${base}/api/platform/jobs/kyc-expiry/run`, { method: 'POST', headers: { 'x-internal-secret': 'ok' } });
    await settle();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ job: 'kyc-expiry', trigger: 'CRON', status: 'RUNNING' }) }));
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run1' }, data: expect.objectContaining({ status: 'SUCCESS', httpStatus: 200, summary: '{"expired":2}' }) }),
    );
    vi.clearAllMocks();
    await fetch(`${base}/api/platform/jobs/kyc-expiry/run`, { method: 'POST' });
    await settle();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trigger: 'MANUAL' }) }));
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', httpStatus: 403, error: 'Forbidden' }) }));
  });
});
