/**
 * /platform/novaryq console data: every restaurant (searchable), its integration state,
 * health, linking progress and order flow, with views "all / on / needs attention / not set up".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ restaurantWhere: null as any }));

vi.mock('@/server/db', () => {
  const restaurants = [
    { id: 'r1', name: 'Spice Route', slug: 'spice-route', status: 'ACTIVE', branches: [{ id: 'b1', city: 'Pune' }, { id: 'b2', city: 'Pune' }] },
    { id: 'r2', name: 'Dosa Den', slug: 'dosa-den', status: 'ACTIVE', branches: [{ id: 'b3', city: 'Bengaluru' }] },
    { id: 'r3', name: 'Chai Corner', slug: 'chai-corner', status: 'ACTIVE', branches: [] },
  ];
  const prisma: any = {
    restaurant: {
      findMany: vi.fn(async ({ where }: any) => { h.restaurantWhere = where; return restaurants; }),
      count: vi.fn(async () => 3),
    },
    integrationCredential: {
      findMany: vi.fn(async () => [
        { restaurantId: 'r1', status: 'CONNECTED', summary: { enabled: true, menuMaster: true }, lastError: null },
        { restaurantId: 'r2', status: 'FAILED', summary: { enabled: true }, lastError: 'HTTP 401' },
      ]),
    },
    novaryqLocationLink: { groupBy: vi.fn(async () => [{ restaurantId: 'r1', _count: { _all: 2 } }]) },
    novaryqItemLink: { groupBy: vi.fn(async () => [{ restaurantId: 'r1', _count: { _all: 40 } }]) },
    novaryqOrderSync: {
      groupBy: vi.fn(async (args: any) =>
        args.by.includes('state')
          ? [{ restaurantId: 'r1', state: 'SENT', _count: { _all: 9 } }, { restaurantId: 'r1', state: 'FAILED', _count: { _all: 1 } }]
          : args.where?.createdAt
            ? [{ restaurantId: 'r1', _count: { _all: 5 } }]
            : [],
      ),
    },
    novaryqWebhookEvent: { groupBy: vi.fn(async () => [{ restaurantId: 'r1', _max: { receivedAt: new Date('2026-10-26T05:00:00Z') } }]) },
  };
  return { prisma, db: prisma };
});

import { platformNovaryqConsole } from '@/server/novaryq/platform';

beforeEach(() => vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('platformNovaryqConsole', () => {
  it('lists every restaurant with its integration state, health and progress', async () => {
    const c = await platformNovaryqConsole({});
    const [r1, r2, r3] = c.rows;
    expect(r1).toMatchObject({
      id: 'r1', name: 'Spice Route', city: 'Pune', state: 'on', health: 'degraded', menuMaster: true,
      branchesLinked: 2, branchesTotal: 2, itemsLinked: 40, sent: 9, sent24h: 5, failed: 1, dead: 0,
    });
    expect(r1.lastWebhookAt).toEqual(new Date('2026-10-26T05:00:00Z'));
    expect(r2).toMatchObject({ id: 'r2', state: 'test_failed', health: 'failing', lastError: 'HTTP 401' });
    expect(r3).toMatchObject({ id: 'r3', state: 'not_set_up', health: 'not_connected', branchesTotal: 0 });
    expect(c.kpis).toEqual({ restaurants: 3, connected: 1, needsAttention: 2, sent24h: 5 });
    expect(c.flagOn).toBe(true);
  });

  it('views filter the rows; search goes to the database by name or slug', async () => {
    expect((await platformNovaryqConsole({ view: 'on' })).rows.map((r) => r.id)).toEqual(['r1']);
    expect((await platformNovaryqConsole({ view: 'attention' })).rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect((await platformNovaryqConsole({ view: 'not_set_up' })).rows.map((r) => r.id)).toEqual(['r3']);
    await platformNovaryqConsole({ q: 'dosa' });
    expect(h.restaurantWhere).toEqual({ OR: [{ name: { contains: 'dosa', mode: 'insensitive' } }, { slug: { contains: 'dosa', mode: 'insensitive' } }] });
  });

  it('with the platform switch off every restaurant reads as off', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    const c = await platformNovaryqConsole({});
    expect(c.flagOn).toBe(false);
    expect(c.rows[0].health).toBe('off');
  });
});
