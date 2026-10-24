/**
 * Agent H — multi-tenant isolation of every Flavrly PG route present on pg/lead, against real
 * Postgres and the real tenancy module. Only the session (auth()) and request cookies are stubbed.
 *
 * PG routes found (src/app/api, grep youpi|pg): payments/youpi/{webhook,status}, admin/youpi/{vpa,request},
 * platform/youpi/{config,requests,[restaurantId]/decision}, platform/jobs/{pg-worker,youpi-reconcile}/run,
 * plus the PG guards added to orders/[id]/pay and admin/orders/[id]/kot. There is NO route yet that
 * reads PgBankTransaction / PgReconException / PgAllocation or imports statements (Agent F not merged).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  process.env.INTERNAL_CRON_SECRET = 'fake-internal-cron-secret-h';
  delete process.env.REDIS_URL;
});
const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string } } }));
vi.mock('@/server/auth', () => ({
  auth: vi.fn(async () => h.session),
  requireRole: vi.fn(async (roles: string[]) => {
    if (!h.session || !roles.includes(h.session.user.role)) throw new Response('Forbidden', { status: 403 });
    return h.session;
  }),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
  sendOtp: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));

import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';
import { GET as statusGET } from '@/app/api/payments/youpi/status/route';
import { POST as vpaPOST } from '@/app/api/admin/youpi/vpa/route';
import { POST as requestPOST } from '@/app/api/admin/youpi/request/route';
import { GET as platformConfigGET, POST as platformConfigPOST } from '@/app/api/platform/youpi/config/route';
import { GET as platformRequestsGET } from '@/app/api/platform/youpi/requests/route';
import { POST as decisionPOST } from '@/app/api/platform/youpi/[restaurantId]/decision/route';
import { POST as workerPOST } from '@/app/api/platform/jobs/pg-worker/run/route';
import * as reconcileRoute from '@/app/api/platform/jobs/youpi-reconcile/run/route';
import { POST as payPOST } from '@/app/api/orders/[id]/pay/route';
import { GET as kotGET } from '@/app/api/admin/orders/[id]/kot/route';
import { makePendingOrder, makeSession, makeTenant, type Tenant } from './h-support';

let A: Tenant;
let B: Tenant;
let orderB: string;
let orderA: string;
let stranger: string;

const as = (id: string, role: string) => {
  h.session = { user: { id, role } };
};
const req = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

beforeAll(async () => {
  A = await makeTenant();
  B = await makeTenant();
  orderA = (await makePendingOrder(A, 5000)).id;
  orderB = (await makePendingOrder(B, 5000)).id;
  await makeSession(A, orderA, 5000);
  await makeSession(B, orderB, 5000);
  stranger = (await prisma.user.create({ data: { email: `stranger-${Date.now()}@example.test`, role: 'CUSTOMER' } })).id;
});
beforeEach(() => {
  h.session = null;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('H tenant isolation: PG routes', () => {
  it("payments/youpi/status: admin A, kitchen-less stranger, other customer cannot read B's order", async () => {
    as(A.ownerId, 'ADMIN');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderB}`))).status).toBe(403);
    as(A.customerId, 'CUSTOMER');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderB}`))).status).toBe(403);
    as(stranger, 'CUSTOMER');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderA}`))).status).toBe(403);
    h.session = null;
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderA}`))).status).toBe(401);
    // Positive controls.
    as(A.ownerId, 'ADMIN');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderA}`))).status).toBe(200);
    as(B.customerId, 'CUSTOMER');
    const ok = await statusGET(req(`/api/payments/youpi/status?orderId=${orderB}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    // Customer view never leaks bank/attempt internals.
    expect(JSON.stringify(body)).not.toMatch(/utr|observedUtr|receivingAccount|vpa|merchant/i);
  });

  it("admin/youpi/vpa: admin A naming B's restaurantId writes only A's config", async () => {
    const before = await getConfig(B.restaurantId, 'YOUPI');
    as(A.ownerId, 'ADMIN');
    const res = await vpaPOST(new Request('http://localhost/api/admin/youpi/vpa', {
      method: 'POST', body: JSON.stringify({ restaurantId: B.restaurantId, receivingVpa: 'attacker@okbank' }),
    }));
    expect([200, 403]).toContain(res.status);
    expect(await getConfig(B.restaurantId, 'YOUPI')).toEqual(before);
  });

  it("admin/youpi/request: admin A naming B's restaurantId cannot change B's feature request", async () => {
    const before = await prisma.youpiFeatureRequest.findUniqueOrThrow({ where: { restaurantId: B.restaurantId } });
    as(A.ownerId, 'ADMIN');
    await requestPOST(new Request('http://localhost/api/admin/youpi/request', { method: 'POST', body: JSON.stringify({ restaurantId: B.restaurantId }) }));
    const after = await prisma.youpiFeatureRequest.findUniqueOrThrow({ where: { restaurantId: B.restaurantId } });
    expect(after.status).toBe(before.status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('platform PG routes refuse a restaurant ADMIN', async () => {
    as(A.ownerId, 'ADMIN');
    expect((await platformConfigGET()).status).toBe(403);
    expect((await platformConfigPOST(req('/api/platform/youpi/config', { method: 'POST', body: { baseUrl: 'https://evil.example', merchantId: 'x', webhookSecret: 'y' } }))).status).toBe(403);
    expect((await platformRequestsGET()).status).toBe(403);
    const d = await decisionPOST(req(`/api/platform/youpi/${B.restaurantId}/decision`, { method: 'POST', body: { decision: 'DISABLE' } }), {
      params: Promise.resolve({ restaurantId: B.restaurantId }),
    });
    expect(d.status).toBe(403);
    expect((await prisma.youpiFeatureRequest.findUniqueOrThrow({ where: { restaurantId: B.restaurantId } })).status).toBe('APPROVED');
  });

  it('worker/cron routes: ADMIN, anonymous and wrong secret -> 403; reconcile route has no GET', async () => {
    as(A.ownerId, 'ADMIN');
    expect((await workerPOST(req('/api/platform/jobs/pg-worker/run', { method: 'POST' }))).status).toBe(403);
    h.session = null;
    expect((await workerPOST(req('/api/platform/jobs/pg-worker/run', { method: 'POST', headers: { 'x-internal-secret': 'wrong' } }))).status).toBe(403);
    expect((await reconcileRoute.POST(req('/api/platform/jobs/youpi-reconcile/run', { method: 'POST', headers: { 'x-internal-secret': 'fake-internal-cron-secret-h-but-longer' } }))).status).toBe(403);
    expect((reconcileRoute as Record<string, unknown>).GET).toBeUndefined();
  });

  it("orders/[id]/pay: admin A cannot open a checkout on B's order", async () => {
    as(A.ownerId, 'ADMIN');
    const res = await payPOST(req(`/api/orders/${orderB}/pay`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: orderB }) });
    expect(res.status).toBe(403);
  });

  it('KOT for an unpaid youpi order is refused (own tenant)', async () => {
    as(A.ownerId, 'ADMIN');
    const res = await kotGET(req(`/api/admin/orders/${orderA}/kot`), { params: Promise.resolve({ id: orderA }) });
    expect(res.status).toBe(409);
    const cross = await kotGET(req(`/api/admin/orders/${orderB}/kot`), { params: Promise.resolve({ id: orderB }) });
    expect([403, 404]).toContain(cross.status);
  });
});
