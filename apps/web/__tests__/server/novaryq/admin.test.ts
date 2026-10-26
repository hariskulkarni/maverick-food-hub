/**
 * Credentials save: blank secrets keep the stored ones ONLY while the Novaryq URL and
 * API key stay the same (QA-F8) — otherwise a restaurant admin who never sees the
 * secret could point the URL at their own host and receive a request signed with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ stored: null as any, saved: [] as any[] }));

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));
vi.mock('@/server/db', () => {
  const prisma: any = { integrationCredential: { findUnique: vi.fn(async () => (h.stored ? { configEncrypted: 'blob' } : null)) } };
  return { prisma, db: prisma };
});
vi.mock('@/server/crypto', async (orig) => ({ ...(await orig<any>()), decryptJSON: () => h.stored }));
vi.mock('@/server/integrations', () => ({
  testAndSave: vi.fn(async (_r: string, _p: string, cfg: any) => { h.saved.push(cfg); return { ok: true, detail: 'ok' }; }),
  disconnect: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));

import { saveNovaryqCredentials } from '@/server/novaryq/admin';

const ctx = { restaurantId: 'r1', restaurantName: 'R', userId: 'u1' };

beforeEach(() => {
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

  it('refuses a non-public / non-https URL before anything is saved', async () => {
    h.stored = null;
    const r = await saveNovaryqCredentials(ctx, { baseUrl: 'http://10.0.0.1', clientId: 'k', secret: 's', enabled: true });
    expect(r.ok).toBe(false);
    expect(h.saved).toHaveLength(0);
  });
});
