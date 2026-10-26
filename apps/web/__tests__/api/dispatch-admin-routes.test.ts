/**
 * Dispatch telemetry admin/platform routes: food-ready (auth, tenancy,
 * idempotency, audit), dispatch settings, dispatch insights (+ CSV), the
 * restaurant-scoped insights route and the four job routes' auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scope: any;
let order: any;
let afterRace: any;
const transitions: any[] = [];
const audits: any[] = [];
let transitionImpl: (id: string, next: string) => Promise<unknown>;
let superAdmin = true;
let jit: any;
let insightsArgs: any[] = [];
let managedRestaurant: any;
let jobAllowed = false;

vi.mock('@/app/api/admin/orders/_helpers', () => ({ requireOwnedOrder: async () => scope }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: {
      findFirst: async () => order,
      findUnique: async () => afterRace,
    },
  },
}));
vi.mock('@/server/orders', () => {
  class OrderTransitionError extends Error {}
  return {
    OrderTransitionError,
    transitionOrder: async (id: string, next: string, opts: any) => { transitions.push({ id, next, opts }); return transitionImpl(id, next); },
  };
});
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { audits.push({ action, opts }); } }));
vi.mock('@/server/tenancy', () => ({
  requireSuperAdmin: async () => { if (!superAdmin) throw new Response('Forbidden', { status: 403 }); return { user: { id: 'sa1', role: 'SUPER_ADMIN' } }; },
  requireManagedRestaurant: async () => { if (!managedRestaurant) throw new Response('Forbidden', { status: 403 }); return managedRestaurant; },
}));
vi.mock('@/server/dispatch/settings', () => ({
  getJitConfig: async () => jit,
  setJitConfig: async (patch: any) => { jit = { ...jit, ...patch }; return jit; },
  JIT_DEFAULTS: { enabled: false },
  JIT_BOUNDS: {},
}));
vi.mock('@/server/dispatch/insights', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getDispatchInsights: async (f: any, o: any) => {
      insightsArgs.push({ f, o });
      const k = real.toKpiBlock({ orders: 3, delivered: 2 });
      return { range: { from: f.from, to: f.to, days: 1 }, summary: k, inviteAcceptance: {}, ordersPerRiderHour: {}, unassignedOver5MinLive: 1, daily: [{ day: f.from, ...k }], restaurants: [], zones: { bucketAt: null, latest: [] } };
    },
  };
});
vi.mock('@/server/reviews/cron-auth', () => ({ jobAllowed: async () => jobAllowed }));
const sweeps = { jit: vi.fn(async () => ({ enabled: false, held: 0, released: 0, byReason: {} })), stat: vi.fn(async () => ({ checked: 0, alerted: 0, debounced: 0 })), zone: vi.fn(async () => ({ cells: 0 })), prep: vi.fn(async () => ({ restaurants: 0, rows: 0 })) };
vi.mock('@/server/dispatch/jit', () => ({ runJitReleaseSweep: () => sweeps.jit() }));
vi.mock('@/server/dispatch/stationary', () => ({ runStationarySweep: () => sweeps.stat() }));
vi.mock('@/server/dispatch/zones', () => ({ runZoneSnapshot: () => sweeps.zone(), NO_FIX_CELL: 'none' }));
vi.mock('@/server/dispatch/prep', () => ({ computePrepStats: () => sweeps.prep() }));

import { POST as foodReady } from '@/app/api/admin/orders/[id]/food-ready/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/platform/dispatch-settings/route';
import { GET as getInsights } from '@/app/api/platform/dispatch-insights/route';
import { GET as getAdminInsights } from '@/app/api/admin/dispatch-insights/route';
import { POST as jitJob } from '@/app/api/platform/jobs/dispatch-jit/run/route';
import { POST as statJob } from '@/app/api/platform/jobs/rider-stationary/run/route';
import { POST as zoneJob } from '@/app/api/platform/jobs/zone-snapshot/run/route';
import { POST as prepJob } from '@/app/api/platform/jobs/prep-stats/run/route';
import { OrderTransitionError } from '@/server/orders';

const fr = (id = 'o1') => foodReady({} as any, { params: Promise.resolve({ id }) });
const req = (url: string, body?: unknown) => ({ nextUrl: new URL(url), url, json: async () => body, headers: new Headers() }) as any;

beforeEach(() => {
  scope = { session: { user: { id: 'k1', role: 'KITCHEN' } }, scopeRestaurantId: 'r1' };
  order = { id: 'o1', code: 'ORD-1', status: 'PREPARING', branch: { restaurantId: 'r1' } };
  afterRace = null;
  transitions.length = 0;
  audits.length = 0;
  transitionImpl = async () => ({});
  superAdmin = true;
  jit = { enabled: false, bufferMin: 3, roadFactor: 1.35, speedKph: 20, rangeKm: 5, promiseSlaMin: 45 };
  insightsArgs = [];
  managedRestaurant = { id: 'r1' };
  jobAllowed = false;
});

describe('POST /api/admin/orders/[id]/food-ready', () => {
  it('returns the scope error (auth / cross-tenant) without transitioning', async () => {
    scope = { error: Response.json({ error: 'Order not found.' }, { status: 404 }) };
    expect((await fr()).status).toBe(404);
    expect(transitions).toHaveLength(0);
  });

  it('marks a PREPARING order READY as KITCHEN source, scoped, and audits', async () => {
    const r = await fr();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, alreadyReady: false, status: 'READY' });
    expect(transitions).toEqual([{ id: 'o1', next: 'READY', opts: expect.objectContaining({ eventSource: 'KITCHEN', scopeRestaurantId: 'r1', actorId: 'k1' }) }]);
    expect(audits[0]).toMatchObject({ action: 'order.food_ready', opts: { entityId: 'o1', restaurantId: 'r1', before: { status: 'PREPARING' } } });
  });

  it('walks an ACCEPTED order through PREPARING first', async () => {
    order.status = 'ACCEPTED';
    await fr();
    expect(transitions.map((t) => t.next)).toEqual(['PREPARING', 'READY']);
  });

  it('is idempotent for orders already READY or further along (no transition, no audit)', async () => {
    for (const status of ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      order.status = status;
      const r = await fr();
      expect(r.status).toBe(200);
      expect((await r.json()).alreadyReady).toBe(true);
    }
    expect(transitions).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('409s for not-yet-accepted and closed orders', async () => {
    order.status = 'RECEIVED';
    expect((await fr()).status).toBe(409);
    order.status = 'CANCELLED_BY_CUSTOMER';
    expect((await fr()).status).toBe(409);
    expect(transitions).toHaveLength(0);
  });

  it('treats a lost race to another tap as success', async () => {
    transitionImpl = async () => { throw new OrderTransitionError('Order was changed concurrently; please retry.'); };
    afterRace = { status: 'READY' };
    const r = await fr();
    expect(r.status).toBe(200);
    expect((await r.json()).alreadyReady).toBe(true);
  });

  it('attributes a super-admin tap to ADMIN', async () => {
    scope = { session: { user: { id: 'sa', role: 'SUPER_ADMIN' } }, scopeRestaurantId: null };
    await fr();
    expect(transitions[0].opts.eventSource).toBe('ADMIN');
  });
});

describe('dispatch settings route', () => {
  it('is super-admin only', async () => {
    superAdmin = false;
    expect((await getSettings()).status).toBe(403);
    expect((await putSettings(req('http://x/api', { enabled: true }))).status).toBe(403);
  });
  it('returns the config and saves a validated patch with an audit row', async () => {
    expect((await (await getSettings()).json()).jit.enabled).toBe(false);
    const r = await putSettings(req('http://x/api', { enabled: true, bufferMin: 4 }));
    expect(r.status).toBe(200);
    expect((await r.json()).jit).toMatchObject({ enabled: true, bufferMin: 4 });
    expect(audits[0]).toMatchObject({ action: 'platform.dispatch_jit.update', opts: { before: { enabled: false }, after: { enabled: true } } });
  });
  it('rejects unknown or mistyped fields', async () => {
    expect((await putSettings(req('http://x/api', { enabled: 'yes' }))).status).toBe(400);
    expect((await putSettings(req('http://x/api', { surprise: 1 }))).status).toBe(400);
    expect(audits).toHaveLength(0);
  });
});

describe('dispatch insights routes', () => {
  it('platform: super-admin only, passes filters + promise SLA, JSON and CSV', async () => {
    superAdmin = false;
    expect((await getInsights(req('http://x/api/platform/dispatch-insights'))).status).toBe(403);
    superAdmin = true;
    const r = await getInsights(req('http://x/api/platform/dispatch-insights?from=2026-10-20&to=2026-10-21&restaurantId=r9&city=Pune'));
    expect(r.status).toBe(200);
    expect(insightsArgs[0]).toMatchObject({ f: { from: '2026-10-20', to: '2026-10-21', restaurantId: 'r9', city: 'Pune' }, o: { slaMin: 45 } });
    const csv = await getInsights(req('http://x/api/platform/dispatch-insights?from=2026-10-20&to=2026-10-20&format=csv'));
    expect(csv.headers.get('Content-Type')).toMatch(/text\/csv/);
    const text = await csv.text();
    expect(text).toContain('assign_p50_min');
    expect(text).toContain('2026-10-20,3,2');
  });
  it('platform: 400 on malformed query', async () => {
    expect((await getInsights(req('http://x/api/platform/dispatch-insights?from=yesterday'))).status).toBe(400);
  });
  it('admin: pinned to the managed restaurant, no cross-restaurant tables', async () => {
    const r = await getAdminInsights(req('http://x/api/admin/dispatch-insights?from=2026-10-20&to=2026-10-20&restaurantId=other'));
    expect(r.status).toBe(200);
    expect(insightsArgs[0].f.restaurantId).toBe('r1');
    expect(insightsArgs[0].o).toMatchObject({ includeRestaurants: false, includeZones: false });
    const body = await r.json();
    expect(body.restaurants).toBeUndefined();
    managedRestaurant = null;
    expect((await getAdminInsights(req('http://x/api/admin/dispatch-insights'))).status).toBe(403);
  });
});

describe('dispatch job routes', () => {
  it.each([
    ['dispatch-jit', jitJob, 'jit'],
    ['rider-stationary', statJob, 'stat'],
    ['zone-snapshot', zoneJob, 'zone'],
    ['prep-stats', prepJob, 'prep'],
  ] as const)('%s: 403 without secret/super-admin, runs when allowed', async (_n, handler, key) => {
    jobAllowed = false;
    expect((await handler(req('http://x/run'))).status).toBe(403);
    expect(sweeps[key]).not.toHaveBeenCalled();
    jobAllowed = true;
    const r = await handler(req('http://x/run'));
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    expect(sweeps[key]).toHaveBeenCalledTimes(1);
  });
});
