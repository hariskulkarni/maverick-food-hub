/**
 * Agent H — multi-tenant isolation of every Flavrly PG route present on pg/lead, against real
 * Postgres and the real tenancy module. Only the session (auth()) and request cookies are stubbed.
 *
 * PG routes found (src/app/api, grep youpi|pg): payments/youpi/{webhook,status}, admin/youpi/{vpa,request},
 * platform/youpi/{config,requests,[restaurantId]/decision}, platform/jobs/{pg-worker,youpi-reconcile}/run,
 * plus the PG guards added to orders/[id]/pay and admin/orders/[id]/kot, and (Agent F, b59f9a2)
 * admin/pg/{statements,report,refunds/[refundId]} and platform/youpi/{accounts,allocations,bank-entries,exceptions}.
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
import { POST as statementsPOST } from '@/app/api/admin/pg/statements/route';
import { GET as reportGET } from '@/app/api/admin/pg/report/route';
import { POST as refundActionPOST } from '@/app/api/admin/pg/refunds/[refundId]/route';
import { POST as pAccountsPOST } from '@/app/api/platform/youpi/accounts/route';
import { POST as pAccountPOST } from '@/app/api/platform/youpi/accounts/[id]/route';
import { POST as pAllocPOST } from '@/app/api/platform/youpi/allocations/route';
import { POST as pAllocApprovePOST } from '@/app/api/platform/youpi/allocations/[proposalId]/approve/route';
import { POST as pBankPOST } from '@/app/api/platform/youpi/bank-entries/route';
import { POST as pBankApprovePOST } from '@/app/api/platform/youpi/bank-entries/[id]/approve/route';
import { POST as pExResolvePOST } from '@/app/api/platform/youpi/exceptions/[id]/resolve/route';
import { recordObservation, tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { requestPgRefund } from '@/server/pg/refunds';
import { MAPPING, makePendingOrder, makeSession, makeTenant, statementCsv, uid, type Tenant } from './h-support';

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
    // Uniform 404 (no order-existence oracle) since b59f9a2.
    as(A.ownerId, 'ADMIN');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderB}`))).status).toBe(404);
    as(A.customerId, 'CUSTOMER');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderB}`))).status).toBe(404);
    as(stranger, 'CUSTOMER');
    expect((await statusGET(req(`/api/payments/youpi/status?orderId=${orderA}`))).status).toBe(404);
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
    // The route now ignores any body and always acts on the caller's own restaurant (no request arg).
    await requestPOST();
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

describe('H tenant isolation: Agent F PG admin routes', () => {
  /** B: captured + cancelled order with a PENDING manual refund (what admin A will try to touch). */
  async function bRefund() {
    const o = await makePendingOrder(B, 7000);
    const s = await makeSession(B, o.id, 7000);
    const utr = `U${uid().toUpperCase()}`;
    await recordObservation({ attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK', utr, amountPaise: 7000, authenticated: true, dedupeKey: `h:${uid()}` });
    const t = await prisma.pgBankTransaction.create({
      data: { receivingAccountId: B.account.id, direction: 'CREDIT', amountPaise: 7000, bankReference: utr, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid() },
    });
    await tryAllocateBankTxn(t.id);
    await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED_BY_ADMIN' } });
    const r = await requestPgRefund({ attemptId: s.attempt.id, amountPaise: 7000, kind: 'ORDER', reason: 'x', actor: { id: B.ownerId } });
    return { refundId: r.refundId, orderCode: (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).code };
  }

  it("admin/pg/statements: admin A cannot import into B's receiving account; KITCHEN and CUSTOMER refused", async () => {
    const body = { receivingAccountId: B.account.id, fileName: 'x.csv', content: statementCsv([{ ref: `X${uid()}`, creditPaise: 100 }]), mapping: MAPPING };
    as(A.ownerId, 'ADMIN');
    const r = await statementsPOST(new Request('http://localhost/api/admin/pg/statements', { method: 'POST', body: JSON.stringify(body) }));
    expect(r.status).toBe(404);
    expect(await prisma.pgStatementImport.count({ where: { receivingAccountId: B.account.id } })).toBe(0);
    as(A.ownerId, 'KITCHEN');
    expect((await statementsPOST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ ...body, receivingAccountId: A.account.id }) }))).status).toBe(403);
    as(A.customerId, 'CUSTOMER');
    expect((await statementsPOST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ ...body, receivingAccountId: A.account.id }) }))).status).toBe(403);
  });

  it("admin/pg/refunds/[id]: admin A cannot approve/complete/fail B's refund (404, unchanged)", async () => {
    const { refundId } = await bRefund();
    as(A.ownerId, 'ADMIN');
    for (const body of [{ action: 'APPROVE' }, { action: 'COMPLETE', bankReference: 'RFX1234567', note: 'n' }, { action: 'FAIL', reason: 'r' }]) {
      const res = await refundActionPOST(new Request(`http://localhost/api/admin/pg/refunds/${refundId}`, { method: 'POST', body: JSON.stringify(body) }), {
        params: Promise.resolve({ refundId }),
      });
      expect(res.status).toBe(404);
    }
    const rec = await prisma.pgRefundRecord.findUniqueOrThrow({ where: { refundId } });
    expect(rec).toMatchObject({ approvedById: null, bankReference: null });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).status).toBe('PENDING');
  });

  it("admin/pg/report: admin A's CSV never contains B's orders", async () => {
    const { orderCode } = await bRefund();
    as(A.ownerId, 'ADMIN');
    const d = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await reportGET(new Request(`http://localhost/api/admin/pg/report?from=${d}&to=${d}`));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).not.toContain(orderCode);
    expect(csv).not.toContain(B.account.vpa);
  });

  it('platform/youpi PG ops routes refuse a restaurant ADMIN and anonymous callers', async () => {
    const post = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
    for (const who of [() => as(A.ownerId, 'ADMIN'), () => { h.session = null; }]) {
      who();
      const statuses = [
        (await pAccountsPOST(post({ restaurantId: A.restaurantId }))).status,
        (await pAccountPOST(post({ action: 'VERIFY' }), { params: Promise.resolve({ id: B.account.id }) })).status,
        (await pAllocPOST(post({}))).status,
        (await pAllocApprovePOST(post({}), { params: Promise.resolve({ proposalId: 'p' }) })).status,
        (await pBankPOST(post({}))).status,
        (await pBankApprovePOST(post({}), { params: Promise.resolve({ id: 'b' }) })).status,
        (await pExResolvePOST(post({ resolution: 'x' }), { params: Promise.resolve({ id: 'e' }) })).status,
      ];
      for (const st of statuses) expect([401, 403]).toContain(st);
    }
  });
});
