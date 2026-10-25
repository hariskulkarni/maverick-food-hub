/**
 * /api/platform/rider-settings (GET/PATCH) and /impact (GET): super-admin
 * only (403 otherwise), validation, persistence of both stores (rider-ops
 * keys + training shift gate) and the audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let superAdmin = true;
let ops: any;
let trainingGate = false;
const audits: any[] = [];
const opsWrites: any[] = [];
const impact = { activeRiders: 5, onlineRiders: 2, kyc: { blocked: 2, blockedOnline: 1, byType: { AADHAAR: 2 } }, training: { blocked: 0, blockedOnline: 0 }, computedAt: 'x' };

vi.mock('@/server/tenancy', () => ({
  requireSuperAdmin: async () => {
    if (!superAdmin) throw new Response('Forbidden', { status: 403 });
    return { user: { id: 'sa1', role: 'SUPER_ADMIN' } };
  },
}));
vi.mock('@/server/platform-settings', () => ({
  getRiderOpsSettings: async () => ({ ...ops }),
  setRiderOpsSettings: async (patch: any) => { opsWrites.push(patch); ops = { ...ops, ...patch }; return { ...ops }; },
  getTrainingShiftGate: async () => trainingGate,
  setTrainingShiftGate: async (on: boolean) => { trainingGate = on; return on; },
}));
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { audits.push({ action, opts }); } }));
vi.mock('@/server/http/client-ip', () => ({ clientIp: () => '127.0.0.1' }));
vi.mock('@/server/rider-settings-impact', () => ({ computeRiderGateImpact: async () => impact }));

import { GET, PATCH } from '@/app/api/platform/rider-settings/route';
import { GET as getImpact } from '@/app/api/platform/rider-settings/impact/route';

const patch = (body: unknown) => PATCH({ json: async () => body, headers: new Headers() } as any);

beforeEach(() => {
  superAdmin = true;
  ops = { kycGate: true, maxActiveOrders: 2, dailyGoal: 1500, weeklyGoal: 9000 };
  trainingGate = false;
  audits.length = 0;
  opsWrites.length = 0;
});

describe('auth', () => {
  it('403 for non-super-admin on GET, PATCH and impact; nothing written', async () => {
    superAdmin = false;
    expect((await GET()).status).toBe(403);
    expect((await patch({ kycGate: false })).status).toBe(403);
    expect((await getImpact()).status).toBe(403);
    expect(opsWrites).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(ops.kycGate).toBe(true);
  });
});

describe('GET', () => {
  it('returns rider-ops settings plus the training shift gate', async () => {
    trainingGate = true;
    expect(await (await GET()).json()).toEqual({ kycGate: true, maxActiveOrders: 2, dailyGoal: 1500, weeklyGoal: 9000, trainingShiftGate: true });
  });
});

describe('PATCH', () => {
  it('rejects out-of-range and unknown fields with 400', async () => {
    expect((await patch({ maxActiveOrders: 11 })).status).toBe(400);
    expect((await patch({ maxActiveOrders: 1.5 })).status).toBe(400);
    expect((await patch({ dailyGoal: 0 })).status).toBe(400);
    expect((await patch({ trainingShiftGate: 'yes' })).status).toBe(400);
    expect((await patch({ bogus: 1 })).status).toBe(400);
    expect((await patch(null)).status).toBe(400);
    expect(audits).toHaveLength(0);
  });

  it('saves rider-ops keys and audits before/after', async () => {
    const r = await patch({ kycGate: false, maxActiveOrders: 3 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ kycGate: false, maxActiveOrders: 3, trainingShiftGate: false });
    expect(opsWrites).toEqual([{ kycGate: false, maxActiveOrders: 3 }]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('platform.rider-settings.update');
    expect(audits[0].opts).toMatchObject({
      actorId: 'sa1',
      entityId: 'rider-ops',
      before: { kycGate: true, maxActiveOrders: 2 },
      after: { kycGate: false, maxActiveOrders: 3 },
    });
  });

  it('toggles the training shift gate without rewriting rider-ops keys', async () => {
    const r = await patch({ trainingShiftGate: true });
    expect(await r.json()).toMatchObject({ trainingShiftGate: true, kycGate: true });
    expect(trainingGate).toBe(true);
    expect(opsWrites).toHaveLength(0);
    expect(audits[0].opts.before.trainingShiftGate).toBe(false);
    expect(audits[0].opts.after.trainingShiftGate).toBe(true);
  });
});

describe('impact', () => {
  it('returns the computed blocked-rider counts', async () => {
    const r = await getImpact();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(impact);
  });
});
