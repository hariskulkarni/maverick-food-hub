import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fr: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/server/db', () => ({
  prisma: { youpiFeatureRequest: { findUnique: h.fr }, pgReceivingAccount: { findMany: h.findMany, count: h.count } },
}));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolveBinding } from '@/server/pg/merchant-binding';

// Obviously fake credentials.
const account = (over: any = {}) => ({
  id: 'acc1', restaurantId: 'r1', gatewayMerchantId: 'gm-r1', vpa: 'Shop@Bank', vpaNormalized: 'shop@bank',
  status: 'VERIFIED', disabledForNewAt: null, dailyCountLimit: null, maxAmountPaise: null, ...over,
});
const platform = { baseUrl: 'https://pg.test/', merchantId: 'gm-platform', webhookSecret: 'whs-platform-fake' };
const restCreds = { merchantId: 'gm-r1', merchantKey: 'mk-r1-fake', webhookSecret: 'whs-r1-fake' };

function wire(o: { approved?: boolean; accounts?: any[]; shared?: number; rest?: any; platform?: any } = {}) {
  h.fr.mockResolvedValue({ status: o.approved === false ? 'REQUESTED' : 'APPROVED' });
  h.findMany.mockResolvedValue(o.accounts ?? [account()]);
  h.count.mockResolvedValue(o.shared ?? 0);
  h.getConfig.mockImplementation(async (id: string) => (id === '__platform__' ? (o.platform === undefined ? platform : o.platform) : o.rest === undefined ? restCreds : o.rest));
}

beforeEach(() => vi.clearAllMocks());

describe('resolveBinding', () => {
  it('binds per-restaurant credentials to the verified account; account VPA authoritative', async () => {
    wire();
    const b = await resolveBinding('r1', { forNew: true });
    expect(b).toMatchObject({
      restaurantId: 'r1', receivingAccountId: 'acc1', gatewayMerchantId: 'gm-r1', vpa: 'shop@bank',
      baseUrl: 'https://pg.test', merchantId: 'gm-r1', merchantKey: 'mk-r1-fake', webhookSecret: 'whs-r1-fake',
      credentialSource: 'RESTAURANT', disabledForNew: false,
    });
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ restaurantId: 'r1', status: 'VERIFIED', disabledForNewAt: null });
  });

  it('null without restaurantId, without APPROVED request (new sessions)', async () => {
    wire();
    expect(await resolveBinding(null, { forNew: true })).toBeNull();
    wire({ approved: false });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
  });

  it('null when there is no verified account or more than one (no guessing)', async () => {
    wire({ accounts: [] });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    wire({ accounts: [account(), account({ id: 'acc2', vpaNormalized: 'b@bank' })] });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
  });

  it('disabled merchant: no NEW session, but reconciliation still resolves config', async () => {
    // forNew filters disabled/suspended accounts out at the query.
    wire({ accounts: [] });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    h.fr.mockClear();
    wire({ approved: false, accounts: [account({ status: 'SUSPENDED', disabledForNewAt: new Date() })] });
    const b = await resolveBinding('r1', { forNew: false });
    expect(b).toMatchObject({ receivingAccountId: 'acc1', disabledForNew: true });
    expect(h.fr).not.toHaveBeenCalled();
    expect(h.findMany.mock.calls.at(-1)![0].where.status).toEqual({ in: ['VERIFIED', 'SUSPENDED'] });
  });

  it('two restaurants sharing a gatewayMerchantId -> fail closed', async () => {
    wire({ shared: 1 });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    expect(await resolveBinding('r1', { forNew: false })).toBeNull();
    expect(h.count.mock.calls[0][0].where).toEqual({ gatewayMerchantId: 'gm-r1', status: 'VERIFIED', restaurantId: { not: 'r1' } });
  });

  it('cross-tenant: restaurant credentials for a different gateway merchant -> null', async () => {
    wire({ rest: { ...restCreds, merchantId: 'gm-OTHER' } });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
  });

  it('platform credentials only when the account is bound to the platform merchant', async () => {
    wire({ rest: { receivingVpa: 'shop@bank' } }); // no per-restaurant merchant creds
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    wire({ rest: { receivingVpa: 'shop@bank' }, accounts: [account({ gatewayMerchantId: 'gm-platform' })] });
    const b = await resolveBinding('r1', { forNew: true });
    expect(b).toMatchObject({ credentialSource: 'PLATFORM', merchantId: 'gm-platform', webhookSecret: 'whs-platform-fake' });
    expect(b!.merchantKey).toBeUndefined();
  });

  it('missing webhookSecret or baseUrl -> null', async () => {
    wire({ rest: { merchantId: 'gm-r1' } });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    wire({ platform: null });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
  });

  it('restaurant receivingVpa is a cross-check: mismatch blocks new sessions only', async () => {
    wire({ rest: { ...restCreds, receivingVpa: 'other@bank' } });
    expect(await resolveBinding('r1', { forNew: true })).toBeNull();
    expect(await resolveBinding('r1', { forNew: false })).not.toBeNull();
    wire({ rest: { ...restCreds, receivingVpa: ' SHOP@bank ' } });
    expect(await resolveBinding('r1', { forNew: true })).not.toBeNull();
  });

  it('limits only tighten (platform, restaurant, account); defaults otherwise', async () => {
    wire({
      platform: { ...platform, dailyLimit: '30', maxAmountPaise: '300000', maxPendingPerAccount: '2' },
      rest: { ...restCreds, dailyLimit: '50', maxAmountPaise: 'abc' },
      accounts: [account({ dailyCountLimit: 8, maxAmountPaise: 900000 })],
    });
    const b = await resolveBinding('r1', { forNew: true });
    expect(b!.limits).toEqual({
      dailyLimit: 8, maxAmountPaise: 300000, maxPendingPerAccount: 2,
      customerMaxPending: 3, customerWindowMinutes: 15, sessionTtlMinutes: 15,
    });
  });

  it('lookup errors fail closed', async () => {
    wire();
    h.findMany.mockRejectedValue(new Error('db down'));
    expect(await resolveBinding('r1', { forNew: false })).toBeNull();
  });
});
