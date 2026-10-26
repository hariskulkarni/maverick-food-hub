/**
 * ADR-FNI-001 §4.2: when a restaurant marks "POS: Novaryq", Novaryq is the menu master —
 * name, price and availability of LINKED items are read-only on Flavrly (price opt-in
 * override), unlinked items stay editable, and bulk spreadsheet/template imports are refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ cfg: null as any, linked: [] as any[] }));

vi.mock('@/server/db', () => {
  const prisma: any = {
    novaryqItemLink: {
      findMany: vi.fn(async ({ where }: any) => h.linked.filter((l) => where.menuItemId.in.includes(l.menuItemId))),
    },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/novaryq/config', async (orig) => ({ ...(await orig<any>()), loadNovaryqConfig: vi.fn(async () => h.cfg) }));

import { menuMasterState, novaryqItemLock, novaryqBulkImportLock } from '@/server/novaryq/menu-master';

beforeEach(() => {
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.cfg = { baseUrl: 'https://in.novaryq.example', clientId: 'c', secret: 's', webhookSecret: 'w', enabled: true, pushOn: 'RECEIVED', menuMaster: true, allowPriceOverride: false };
  h.linked = [{ menuItemId: 'm1', menuItem: { name: 'Paneer Tikka', price: 249, isAvailable: true } }];
});
afterEach(() => vi.unstubAllEnvs());

describe('menuMasterState', () => {
  it('on only with the flag, an enabled connection and menuMaster set', async () => {
    expect(await menuMasterState('r1')).toEqual({ on: true, allowPriceOverride: false, manageUrl: 'https://in.novaryq.example' });
    h.cfg = { ...h.cfg, menuMaster: false };
    expect((await menuMasterState('r1')).on).toBe(false);
    h.cfg = { ...h.cfg, menuMaster: true, enabled: false };
    expect((await menuMasterState('r1')).on).toBe(false);
    h.cfg = { ...h.cfg, enabled: true };
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    expect((await menuMasterState('r1')).on).toBe(false);
  });
});

describe('novaryqItemLock', () => {
  it('refuses changing name, price or availability of a linked item (409, Manage in Novaryq)', async () => {
    for (const patch of [{ name: 'Paneer Tikka Special' }, { price: 260 }, { isAvailable: false }]) {
      const r = await novaryqItemLock('r1', ['m1'], patch);
      expect(r?.status, JSON.stringify(patch)).toBe(409);
      expect(await r!.json()).toMatchObject({ code: 'novaryq/managed', manageUrl: 'https://in.novaryq.example' });
    }
  });

  it('lets unchanged values (full-form saves), other fields and unlinked items through', async () => {
    expect(await novaryqItemLock('r1', ['m1'], { name: 'Paneer Tikka', price: 249, isAvailable: true })).toBeNull();
    expect(await novaryqItemLock('r1', ['m1'], { description: 'Smoky', imageUrl: 'x' } as any)).toBeNull();
    expect(await novaryqItemLock('r1', ['m9'], { price: 1 })).toBeNull();
  });

  it('channel-only price override is opt-in', async () => {
    h.cfg = { ...h.cfg, allowPriceOverride: true };
    expect(await novaryqItemLock('r1', ['m1'], { price: 279 })).toBeNull();
    expect((await novaryqItemLock('r1', ['m1'], { isAvailable: false }))?.status).toBe(409);
  });

  it('does nothing when Novaryq is not the menu master', async () => {
    h.cfg = { ...h.cfg, menuMaster: false };
    expect(await novaryqItemLock('r1', ['m1'], { price: 1, isAvailable: false })).toBeNull();
  });
});

describe('novaryqBulkImportLock', () => {
  it('refuses spreadsheet/template imports while Novaryq is the menu master', async () => {
    expect((await novaryqBulkImportLock('r1'))?.status).toBe(409);
    h.cfg = { ...h.cfg, menuMaster: false };
    expect(await novaryqBulkImportLock('r1')).toBeNull();
  });
});
