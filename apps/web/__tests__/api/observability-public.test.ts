/**
 * Public observability surfaces: the uptime health endpoint reveals nothing
 * unless the caller is a 2FA super-admin; the client-error beacon is
 * size-capped, rate-limited and stores only redacted data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  queryRaw: vi.fn(),
  alerts: vi.fn(),
  recordError: vi.fn(),
}));
vi.mock('@/server/observability/access', () => ({ requireObservabilityApi: h.gate }));
vi.mock('@/server/db', () => ({ prisma: { $queryRaw: h.queryRaw, obsAlert: { findMany: h.alerts } } }));
vi.mock('@/server/observability/store', () => ({ recordError: h.recordError, appRelease: () => 'abc123' }));

import { GET as health } from '@/app/api/health/route';
import { POST as beacon } from '@/app/api/telemetry/client-error/route';
import { resetBeaconLimits } from '@/server/observability/beacon-limit';

const beaconReq = (body: unknown, ip = '1.2.3.4') => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { headers: new Headers({ 'cf-connecting-ip': ip, 'content-length': String(raw.length) }), text: async () => raw } as never;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetBeaconLimits();
  h.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  h.alerts.mockResolvedValue([{ severity: 'CRITICAL', title: 'Disk low', ruleKey: 'disk_low', firstFiredAt: new Date() }]);
});

describe('/api/health', () => {
  it('public: only ok/status/time — no alert text, versions or counts', async () => {
    h.gate.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await health();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['ok', 'status', 'time']);
    expect(body.status).toBe('degraded');
  });
  it('super-admin with 2FA additionally gets detail', async () => {
    await new Promise((r) => setTimeout(r, 0));
    h.gate.mockResolvedValue({ userId: 'sa', email: null, name: null });
    const body = await (await health()).json();
    expect(body.detail.alerts[0].title).toBe('Disk low');
    expect(body.detail.release).toBe('abc123');
  });
});

describe('/api/telemetry/client-error', () => {
  it('stores a redacted browser error with the route template', async () => {
    const res = await beacon(beaconReq({ message: 'Failed for a@b.com', stack: 'Error\n at x', url: '/r/biryani?token=abc', type: 'error' }));
    expect(res.status).toBe(204);
    expect(h.recordError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'CLIENT', message: 'Failed for a@b.com', path: '/r/biryani' }));
  });
  it('tags rider-app crashes as NATIVE', async () => {
    await beacon(beaconReq({ message: 'TypeError: x', source: 'rider-native', type: 'native-fatal', screen: 'delivery/[id]' }));
    expect(h.recordError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'NATIVE', route: 'native:delivery/[id]' }));
  });
  it('drops noise and invalid bodies silently, rejects oversize', async () => {
    expect((await beacon(beaconReq({ message: 'ResizeObserver loop limit exceeded' }))).status).toBe(204);
    expect((await beacon(beaconReq('not json'))).status).toBe(204);
    expect((await beacon(beaconReq({ nope: 1 }))).status).toBe(204);
    expect(h.recordError).not.toHaveBeenCalled();
    expect((await beacon(beaconReq({ message: 'x'.repeat(20_000) }))).status).toBe(413);
  });
  it('rate-limits per IP', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await beacon(beaconReq({ message: `e${i}` }, '9.9.9.9'))).status;
    expect(last).toBe(429);
    expect((await beacon(beaconReq({ message: 'other ip' }, '8.8.8.8'))).status).toBe(204);
  });
});
