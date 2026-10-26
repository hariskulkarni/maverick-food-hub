/**
 * Credentials save: blank secrets keep the stored ones ONLY while the Novaryq URL and
 * API key stay the same (QA-F8) — otherwise a restaurant admin who never sees the
 * secret could point the URL at their own host and receive a request signed with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ stored: null as any, saved: [] as any[], locations: 1, itemLinks: 3, connected: true }));

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));
vi.mock('@/server/db', () => {
  const prisma: any = {
    integrationCredential: {
      findUnique: vi.fn(async () => (h.stored ? {
        configEncrypted: 'blob', status: h.connected ? 'CONNECTED' : 'FAILED', lastTestedAt: null, lastError: null,
        summary: { baseUrl: h.stored.baseUrl, enabled: h.stored.enabled === 'true', menuMaster: h.stored.menuMaster === 'true', allowPriceOverride: false },
      } : null)),
    },
    restaurant: { findUnique: vi.fn(async () => ({ slug: 'spice-route' })) },
    branch: { findMany: vi.fn(async () => []) },
    novaryqOrderSync: { groupBy: vi.fn(async () => []), count: vi.fn(async () => 0) },
    novaryqWebhookEvent: { findFirst: vi.fn(async () => null) },
    novaryqLocationLink: { count: vi.fn(async () => h.locations) },
    novaryqItemLink: { count: vi.fn(async () => h.itemLinks) },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/crypto', async (orig) => ({ ...(await orig<any>()), decryptJSON: () => h.stored }));
vi.mock('@/server/integrations', () => ({
  saveConfig: vi.fn(async (_r: string, _p: string, cfg: any) => { h.saved.push(cfg); return {}; }),
  testAndSave: vi.fn(async (_r: string, _p: string, cfg: any) => { h.saved.push(cfg); return { ok: true, detail: 'ok' }; }),
  disconnect: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));

import { saveNovaryqCredentials, setMenuMaster, novaryqOverview } from '@/server/novaryq/admin';

const ctx = { restaurantId: 'r1', restaurantName: 'R', userId: 'u1' };

beforeEach(() => {
  h.locations = 1; h.itemLinks = 3; h.connected = true;
  h.stored = { baseUrl: 'https://pos.example.com', clientId: 'nq_live_a', secret: 'nqsec_real', webhookSecret: 'whsec_real', enabled: 'true', pushOn: 'RECEIVED' };
  h.saved = [];
});

describe('saveNovaryqCredentials', () => {
  it('same URL + key: blank secrets keep the stored ones', async () => {
    expect(await saveNovaryqCredentials(ctx, { baseUrl: 'https://pos.example.com/', clientId: 'nq_live_a', enabled: false })).toMatchObject({ ok: true });
    expect(h.saved[0]).toMatchObject({ secret: 'nqsec_real', webhookSecret: 'whsec_real', enabled: 'false' });
  });

  it('a changed URL or API key requires the secrets to be entered again (QA-F8)', async () => {
    const r1 = await saveNovaryqCredentials(ctx, { baseUrl: 'https://attacker.example.com', clientId: 'nq_live_a', enabled: true });
    expect(r1).toMatchObject({ ok: false });
    expect((r1 as any).error).toMatch(/enter the API secret/i);
    const r2 = await saveNovaryqCredentials(ctx, { baseUrl: 'https://pos.example.com', clientId: 'nq_live_b', secret: 'nqsec_new', enabled: true });
    expect(r2).toMatchObject({ ok: false });
    expect(h.saved).toHaveLength(0);
    expect(await saveNovaryqCredentials(ctx, { baseUrl: 'https://pos2.example.com', clientId: 'nq_live_b', secret: 'nqsec_new', webhookSecret: 'whsec_new', enabled: true })).toMatchObject({ ok: true });
    expect(h.saved[0]).toMatchObject({ baseUrl: 'https://pos2.example.com', secret: 'nqsec_new', webhookSecret: 'whsec_new' });
  });

  it('keeps "POS: Novaryq" on a plain re-save, resets it when the URL / key changes', async () => {
    h.stored = { ...h.stored, menuMaster: 'true', allowPriceOverride: 'true' };
    await saveNovaryqCredentials(ctx, { baseUrl: 'https://pos.example.com', clientId: 'nq_live_a', enabled: true });
    expect(h.saved[0]).toMatchObject({ menuMaster: 'true', allowPriceOverride: 'true' });
    await saveNovaryqCredentials(ctx, { baseUrl: 'https://pos3.example.com', clientId: 'nq_live_a', secret: 'x', webhookSecret: 'y', enabled: true });
    expect(h.saved[1]).toMatchObject({ menuMaster: 'false', allowPriceOverride: 'false' });
  });

  it('refuses a non-public / non-https URL before anything is saved', async () => {
    h.stored = null;
    const r = await saveNovaryqCredentials(ctx, { baseUrl: 'http://10.0.0.1', clientId: 'k', secret: 's', enabled: true });
    expect(r.ok).toBe(false);
    expect(h.saved).toHaveLength(0);
  });
});

describe('setMenuMaster ("POS: Novaryq")', () => {
  it('switches on only for a connected, enabled restaurant with a linked branch and linked items', async () => {
    expect(await setMenuMaster(ctx, { on: true, allowPriceOverride: false })).toEqual({ ok: true });
    expect(h.saved[0]).toMatchObject({ menuMaster: 'true', allowPriceOverride: 'false', secret: 'nqsec_real' });
    h.locations = 0;
    expect((await setMenuMaster(ctx, { on: true, allowPriceOverride: false })).ok).toBe(false);
    h.locations = 1; h.itemLinks = 0;
    expect((await setMenuMaster(ctx, { on: true, allowPriceOverride: false })).ok).toBe(false);
    h.itemLinks = 3; h.connected = false;
    expect((await setMenuMaster(ctx, { on: true, allowPriceOverride: false })).ok).toBe(false);
    h.connected = true;
    h.stored = { ...h.stored, enabled: 'false' };
    expect((await setMenuMaster(ctx, { on: true, allowPriceOverride: false })).ok).toBe(false);
  });

  it('switching off is always allowed', async () => {
    h.locations = 0; h.itemLinks = 0;
    expect(await setMenuMaster(ctx, { on: false, allowPriceOverride: false })).toEqual({ ok: true });
    expect(h.saved.at(-1)).toMatchObject({ menuMaster: 'false' });
  });
});

describe('novaryqOverview (India onboarding fields)', () => {
  it('exposes the Flavrly restaurant URL for Novaryq\'s consumer channel, menu-master state and the Manage-in-Novaryq link', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    h.stored = { ...h.stored, menuMaster: 'true' };
    const o = await novaryqOverview('r1');
    expect(o.restaurantUrl).toMatch(/\/r\/spice-route$/);
    expect(o).toMatchObject({ menuMaster: true, allowPriceOverride: false, linkedItems: 3, manageUrl: 'https://pos.example.com' });
    vi.unstubAllEnvs();
  });
});
