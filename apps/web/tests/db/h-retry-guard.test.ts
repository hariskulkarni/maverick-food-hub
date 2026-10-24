/**
 * Agent H — "do not let the customer pay twice" guards, through the real routes and real DB.
 * Session + cookies stubbed; gateway HTTP is a recording fetch stub.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  process.env.NEXT_PUBLIC_SITE_URL = 'https://shop.example.test';
  delete process.env.REDIS_URL;
});
const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string } } }));
vi.mock('@/server/auth', () => ({
  auth: vi.fn(async () => h.session),
  requireRole: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
  sendOtp: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));

import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { POST as payPOST } from '@/app/api/orders/[id]/pay/route';
import { GET as statusGET } from '@/app/api/payments/youpi/status/route';
import { allocateBankCredit, recordObservation } from '@/server/pg/reconcile-engine';
import { gatewayFetch, makePendingOrder, makeSession, makeTenant, uid, type GatewayStatus, type Tenant } from './h-support';

const gw = new Map<string, GatewayStatus>();
const calls: string[] = [];
let A: Tenant;

beforeAll(async () => {
  A = await makeTenant();
});
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw, calls)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe('H retry guards (customer must not be able to pay twice)', () => {
  // DEFECT H-07: /api/orders/[id]/pay -> startOnlinePayment (online.ts:104) only refuses when a Payment
  // is CAPTURED. An attempt the gateway already reported paid (OBSERVED, awaiting the bank statement)
  // or whose create outcome is unknown (CREATE_UNKNOWN, contract D8) does not block a second
  // session, so the customer can be charged twice. (Agent A's attempts.ts is meant to own D8; it is
  // not on pg/lead.)
  it.each(['OBSERVED', 'CREATE_UNKNOWN'] as const)('a new session is refused while an attempt is %s', async (state) => {
    const order = await makePendingOrder(A, 22000);
    const s = await makeSession(A, order.id, 22000, { state });
    if (state === 'OBSERVED') await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { observedUtr: `U${uid().toUpperCase()}` } });
    h.session = { user: { id: A.customerId, role: 'CUSTOMER' } };
    const res = await payPOST(new NextRequest(`http://localhost/api/orders/${order.id}/pay`, { method: 'POST' }), { params: Promise.resolve({ id: order.id }) });
    const createCalls = calls.filter((c) => c.startsWith('POST '));
    expect({ status: res.status, gatewayCreateCalls: createCalls.length }).toEqual({ status: 409, gatewayCreateCalls: 0 });
  });

  // DEFECT H-06: customerPaymentView (pg/customer-status.ts:57) ranks FAILED/EXPIRED attempts as
  // NOT_CONFIRMED with canRetry=true even when the bank already credited that attempt (LATE_PAYMENT
  // allocation) — the status page then offers "pay again" to a customer whose money arrived.
  it('status page does not offer retry when a bank credit was already allocated to the (failed) attempt', async () => {
    const order = await makePendingOrder(A, 23000);
    const s = await makeSession(A, order.id, 23000);
    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { state: 'FAILED' } });
    await prisma.payment.update({ where: { id: s.payment.id }, data: { status: 'FAILED' } });
    const utr = `U${uid().toUpperCase()}`;
    await recordObservation({ attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK', utr, amountPaise: 23000, authenticated: true, dedupeKey: `h:${uid()}` });
    const t = await prisma.pgBankTransaction.create({
      data: { receivingAccountId: A.account.id, direction: 'CREDIT', amountPaise: 23000, bankReference: utr, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid() },
    });
    expect((await allocateBankCredit({ attemptId: s.attempt.id, bankTransactionId: t.id })).outcome).toBe('LATE_PAYMENT');
    h.session = { user: { id: A.customerId, role: 'CUSTOMER' } };
    const body = await (await statusGET(new NextRequest(`http://localhost/api/payments/youpi/status?orderId=${order.id}`))).json();
    expect(body.canRetry).toBe(false);
  });
});
