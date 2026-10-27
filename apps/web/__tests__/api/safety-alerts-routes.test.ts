/**
 * Access control + behaviour for the safety-alert routes:
 *   - PATCH/GET /api/platform/safety-alerts/settings → super-admin only (403),
 *     validation (400), audited persistence.
 *   - POST /api/platform/jobs/safety-alerts/run → internal secret OR super-admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let superAdmin = true;
let settings: any;
const audits: any[] = [];
const writes: any[] = [];

vi.mock('@/server/tenancy', () => ({
  requireSuperAdmin: async () => {
    if (!superAdmin) throw new Response('Forbidden', { status: 403 });
    return { user: { id: 'sa1', role: 'SUPER_ADMIN' } };
  },
}));
vi.mock('@/server/safety/settings', () => ({
  getSafetyAlertSettings: async () => ({ ...settings }),
  setSafetyAlertSettings: async (patch: any) => { writes.push(patch); return { ...settings, ...patch }; },
}));
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { audits.push({ action, opts }); } }));
vi.mock('@/server/http/client-ip', () => ({ clientIp: () => '127.0.0.1' }));

// Job route deps
let jobOk = true;
const sweepRuns: any[] = [];
vi.mock('@/server/reviews/cron-auth', () => ({ jobAllowed: async () => jobOk }));
vi.mock('@/server/safety/alerts', () => ({
  runSafetyAlertsSweep: async () => { const r = { checked: 1, alerted: 0, resolved: 0, debounced: 0, byType: {} }; sweepRuns.push(r); return r; },
}));

import { GET, PATCH } from '@/app/api/platform/safety-alerts/settings/route';
import { POST as runJob } from '@/app/api/platform/jobs/safety-alerts/run/route';

const patch = (body: unknown) => PATCH({ json: async () => body, headers: new Headers() } as any);

beforeEach(() => {
  superAdmin = true;
  jobOk = true;
  settings = {
    routeDeviation: { enabled: true, minutes: 3, metres: 300 },
    etaBreach: { enabled: true, minutes: 15 },
    longWaitAtRestaurant: { enabled: true, minutes: 12 },
    signalLoss: { enabled: true, minutes: 10 },
  };
  audits.length = 0;
  writes.length = 0;
  sweepRuns.length = 0;
});

describe('settings auth', () => {
  it('403 for non-super-admin on GET and PATCH; nothing written or audited', async () => {
    superAdmin = false;
    expect((await GET()).status).toBe(403);
    expect((await patch({ etaBreach: { minutes: 20 } })).status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

describe('settings PATCH validation', () => {
  it('rejects out-of-range / unknown fields with 400', async () => {
    expect((await patch({ etaBreach: { minutes: 0 } })).status).toBe(400);
    expect((await patch({ routeDeviation: { metres: 10 } })).status).toBe(400);
    expect((await patch({ signalLoss: { enabled: 'yes' } })).status).toBe(400);
    expect((await patch({ bogus: 1 })).status).toBe(400);
    expect((await patch(null)).status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('saves a valid toggle+threshold and audits before/after', async () => {
    const r = await patch({ etaBreach: { enabled: false, minutes: 25 } });
    expect(r.status).toBe(200);
    expect(writes).toEqual([{ etaBreach: { enabled: false, minutes: 25 } }]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('platform.safety-alerts.update');
    expect(audits[0].opts).toMatchObject({ actorId: 'sa1', entityId: 'safety-alerts' });
  });
});

describe('job auth', () => {
  it('403 when not allowed; does not run the sweep', async () => {
    jobOk = false;
    const r = await runJob({ headers: new Headers() } as any);
    expect(r.status).toBe(403);
    expect(sweepRuns).toHaveLength(0);
  });
  it('runs the sweep when allowed', async () => {
    const r = await runJob({ headers: new Headers() } as any);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, checked: 1 });
    expect(sweepRuns).toHaveLength(1);
  });
});
