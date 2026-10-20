import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'SUPER_ADMIN' as string,
  saveConfig: vi.fn(async () => ({})),
  getConfig: vi.fn(async (): Promise<Record<string, string> | null> => null),
  audit: vi.fn(async () => undefined),
  credFind: vi.fn(async (): Promise<any> => null),
  reqFindMany: vi.fn(async (): Promise<any[]> => []),
  reqUpsert: vi.fn(async (a: any) => ({ id: 'yr1', restaurantId: a.where.restaurantId, status: a.update.status })),
  reqFind: vi.fn(async (): Promise<any> => ({ id: 'yr1', status: 'REQUESTED' })),
}));

vi.mock('@/server/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', role: h.role } })),
}));
vi.mock('@/server/integrations', () => ({ saveConfig: h.saveConfig, getConfig: h.getConfig }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({
  prisma: {
    integrationCredential: { findUnique: h.credFind },
    youpiFeatureRequest: { findMany: h.reqFindMany, upsert: h.reqUpsert, findUnique: h.reqFind },
  },
}));

import { GET as cfgGET, POST as cfgPOST } from '@/app/api/platform/youpi/config/route';
import { GET as reqGET } from '@/app/api/platform/youpi/requests/route';
import { POST as decide } from '@/app/api/platform/youpi/[restaurantId]/decision/route';

const mk = (body?: unknown) => ({ json: async () => body }) as any;
const ctx = { params: Promise.resolve({ restaurantId: 'r1' }) };
const goodCfg = { baseUrl: 'https://pg.example.com', apiKey: 'sk_live_SECRETKEY123', webhookSecret: 'whsec_SECRET456' };

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'SUPER_ADMIN';
  h.getConfig.mockResolvedValue(null);
  h.credFind.mockResolvedValue(null);
});

describe('non-SUPER_ADMIN gets 403 everywhere', () => {
  for (const role of ['ADMIN', 'ADMIN_ASSIST', 'CUSTOMER']) {
    it(`${role}`, async () => {
      h.role = role;
      const res = [
        await cfgGET(),
        await cfgPOST(mk(goodCfg)),
        await reqGET(),
        await decide(mk({ decision: 'APPROVE' }), ctx),
      ];
      res.forEach((r) => expect(r.status).toBe(403));
      expect(h.saveConfig).not.toHaveBeenCalled();
      expect(h.reqUpsert).not.toHaveBeenCalled();
      expect(h.reqFindMany).not.toHaveBeenCalled();
    });
  }
});

describe('config', () => {
  it('POST saves to the platform sentinel and returns masked only', async () => {
    h.credFind.mockResolvedValue({ status: 'CONNECTED', summary: { baseUrl: goodCfg.baseUrl, apiKey: 'sk_l…123' } });
    const res = await cfgPOST(mk({ ...goodCfg, dailyLimit: 50, maxAmountPaise: 100000 }));
    expect(res.status).toBe(200);
    expect(h.saveConfig).toHaveBeenCalledWith(
      '__platform__', 'YOUPI',
      expect.objectContaining({ baseUrl: goodCfg.baseUrl, apiKey: goodCfg.apiKey, webhookSecret: goodCfg.webhookSecret, dailyLimit: '50', maxAmountPaise: '100000' }),
      expect.objectContaining({ status: 'CONNECTED' }),
    );
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('SECRETKEY123');
    expect(text).not.toContain('SECRET456');
  });

  it('POST rejects invalid body', async () => {
    const res = await cfgPOST(mk({ baseUrl: 'nope' }));
    expect(res.status).toBe(400);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it('GET returns masked summary, never raw secrets', async () => {
    h.credFind.mockResolvedValue({
      status: 'CONNECTED',
      configEncrypted: 'ENC',
      summary: { baseUrl: goodCfg.baseUrl, apiKey: 'sk_l…123', webhookSecret: 'whse…456' },
    });
    const res = await cfgGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain('SECRETKEY123');
    expect(text).not.toContain('SECRET456');
    expect(text).not.toContain('ENC');
    expect(h.getConfig).not.toHaveBeenCalled();
  });

  it('GET when unset', async () => {
    const body = await (await cfgGET()).json();
    expect(body.configured).toBe(false);
  });
});

describe('requests list', () => {
  it('returns id, restaurant name, status, requestedAt', async () => {
    h.reqFindMany.mockResolvedValue([
      { id: 'yr1', restaurantId: 'r1', status: 'REQUESTED', requestedAt: new Date('2026-01-01'), restaurant: { name: 'Tandoor' } },
    ]);
    const body = await (await reqGET()).json();
    expect(body.requests[0]).toMatchObject({ id: 'yr1', restaurantId: 'r1', restaurantName: 'Tandoor', status: 'REQUESTED' });
  });
});

describe('decision', () => {
  it('APPROVE without platform config -> 409', async () => {
    const res = await decide(mk({ decision: 'APPROVE' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/configure the YouPI connection first/i);
    expect(h.reqUpsert).not.toHaveBeenCalled();
  });

  it('APPROVE with config sets APPROVED + decidedBy/At and audits', async () => {
    h.getConfig.mockResolvedValue({ baseUrl: 'x' });
    const res = await decide(mk({ decision: 'APPROVE' }), ctx);
    expect(res.status).toBe(200);
    expect(h.getConfig).toHaveBeenCalledWith('__platform__', 'YOUPI');
    const arg: any = h.reqUpsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ status: 'APPROVED', decidedById: 'u1' });
    expect(arg.update.decidedAt).toBeInstanceOf(Date);
    expect(h.audit).toHaveBeenCalled();
  });

  it.each([['REJECT', 'REJECTED'], ['DISABLE', 'DISABLED']])('%s -> %s (no config needed)', async (d, s) => {
    const res = await decide(mk({ decision: d }), ctx);
    expect(res.status).toBe(200);
    expect((h.reqUpsert.mock.calls[0][0] as any).update).toMatchObject({ status: s, decidedById: 'u1' });
  });

  it('bad decision -> 400', async () => {
    const res = await decide(mk({ decision: 'NUKE' }), ctx);
    expect(res.status).toBe(400);
  });
});
