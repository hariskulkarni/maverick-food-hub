/**
 * Real-Postgres proof (Agent E): settlement rail detection, the Flavrly PG
 * reconciliation report (tenant scoped, integer paise), CSV safety, and GMV
 * reports no longer counting unpaid PAYMENT_PENDING orders.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/tenancy', () => ({ requireSuperAdmin: vi.fn(async () => ({ id: 'sa' })) }));
// gmv-by-day gates via requireSuperAdminApi (api-auth -> auth); stub the session, keep the real gate.
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sa', role: 'SUPER_ADMIN' } })) }));

import { prisma } from '@/server/db';
import { buildSettlementReport } from '@/server/settlement';
import { buildPgReconciliationReport, pgReconciliationCsv } from '@/server/pg/reports';
import { GET as gmvByDay } from '@/app/api/platform/reports/gmv-by-day/route';

const DAY = new Date('2031-03-03T10:00:00Z');
const FROM = new Date('2031-03-01T00:00:00Z');
const TO = new Date('2031-03-05T23:59:59Z');
let n = 0;

async function tenant(slug: string) {
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: `${slug}@test.invalid` } });
  const r = await prisma.restaurant.create({ data: { slug, name: `${slug} kitchen`, ownerUserId: owner.id, commissionPct: 10, paymentFeePct: 2 } });
  const b = await prisma.branch.create({ data: { restaurantId: r.id, name: 'Main', slug: `${slug}-main`, line1: 'x', city: 'y', postalCode: '560001' } });
  const acct = await prisma.pgReceivingAccount.create({
    data: {
      restaurantId: r.id, gatewayMerchantId: `m-${slug}`, vpa: `${slug}shop@okbank`, vpaNormalized: `${slug}shop@okbank`,
      accountFingerprint: `fp-${slug}`, accountLast4: '4321', legalEntityName: 'Pvt', status: 'VERIFIED',
    },
  });
  return { restaurantId: r.id, branchId: b.id, accountId: acct.id };
}

let customerId = '';

async function order(branchId: string, opts: { status: string; method?: string; provider?: string; payStatus?: string; total?: number; code?: string }) {
  const total = opts.total ?? 100;
  const o = await prisma.order.create({
    data: {
      code: opts.code ?? `R-${n++}-${Date.now().toString(36)}`, branchId, customerId, subtotal: total as any, total: total as any,
      paymentMethod: (opts.method ?? 'PHONEPE') as any, status: opts.status as any, placedAt: DAY,
    },
  });
  const p = opts.provider
    ? await prisma.payment.create({
        data: { orderId: o.id, method: (opts.method ?? 'PHONEPE') as any, status: (opts.payStatus ?? 'CAPTURED') as any, amount: total as any, providerName: opts.provider },
      })
    : null;
  return { orderId: o.id, paymentId: p?.id ?? '' };
}

async function attempt(t: { restaurantId: string; accountId: string }, orderId: string, paymentId: string, state: string, allocs: [string, number, string][]) {
  const a = await prisma.pgPaymentAttempt.create({
    data: {
      paymentId, orderId, restaurantId: t.restaurantId, receivingAccountId: t.accountId, attemptKey: `${orderId}-a`, idempotencyKey: `${orderId}-a`,
      gatewayMerchantId: 'gm', gatewayPaymentId: `gw-${orderId}`, expectedAmountPaise: 10000, state: state as any, observedUtr: allocs[0]?.[2] ?? null,
      createdAt: DAY,
    },
  });
  await prisma.pgPaymentEvidence.create({
    data: {
      attemptId: a.id, restaurantId: t.restaurantId, source: 'GATEWAY_WEBHOOK', observedAmountPaise: 10000, sourceAuthenticated: true,
      verificationMethod: 'hmac', dedupeKey: `ev-${a.id}`,
    },
  });
  for (const [kind, amountPaise, utr] of allocs) {
    const txn = await prisma.pgBankTransaction.create({
      data: { receivingAccountId: t.accountId, direction: 'CREDIT', amountPaise, bankReference: utr, valueAt: DAY, source: 'STATEMENT_IMPORT', sourceRowHash: `h-${utr}`, status: 'ALLOCATED' },
    });
    await prisma.pgAllocation.create({ data: { bankTransactionId: txn.id, attemptId: a.id, orderId, kind: kind as any, amountPaise } });
  }
  return a.id;
}

let A: Awaited<ReturnType<typeof tenant>>;
let B: Awaited<ReturnType<typeof tenant>>;

beforeAll(async () => {
  customerId = (await prisma.user.create({ data: { role: 'CUSTOMER', phone: '+910000000077' } })).id;
  A = await tenant('ea');
  B = await tenant('eb');
});

describe('settlement report rail detection (DB)', () => {
  it('youpi delivered order: no fee, no payout, receivable; PhonePe order unchanged', async () => {
    const t = await tenant('es');
    await order(t.branchId, { status: 'DELIVERED', provider: 'youpi' });
    await order(t.branchId, { status: 'DELIVERED', provider: 'phonepe' });
    const rep = await buildSettlementReport(t.restaurantId, FROM, TO);
    const direct = rep.lines.find((l) => l.settlementMode === 'DIRECT_TO_MERCHANT')!;
    const psp = rep.lines.find((l) => l.settlementMode === 'PLATFORM_COLLECTED')!;
    expect(psp).toMatchObject({ paymentFee: 2, commission: 10 });
    expect(psp.payout).toBeGreaterThan(0);
    expect(direct).toMatchObject({ paymentFee: 0, commission: 10, payout: 0, collectedByMerchant: 100 });
    expect(direct.commissionReceivable).toBe(direct.netDeductions);
    expect(rep.summary.netPayout).toBe(psp.payout);
    expect(rep.summary.directToMerchantOrders).toBe(1);
    expect(rep.summary.commissionReceivable).toBe(direct.commissionReceivable);
  });
});

describe('buildPgReconciliationReport', () => {
  it('rows in integer paise, tenant scoped, with refunds/adjustments/exceptions', async () => {
    // A1: delivered, ORDER 10000 + OVERCOLLECTION 10000, 2500 refunded (completed), overcollection exception
    const o1 = await order(A.branchId, { status: 'DELIVERED', provider: 'youpi', code: '=HYPERLINK("http://x")' });
    const a1 = await attempt(A, o1.orderId, o1.paymentId, 'CAPTURED', [['ORDER_PAYMENT', 10000, 'UTRA1000001'], ['OVERCOLLECTION', 10000, 'UTRA1000002']]);
    const refund = await prisma.refund.create({ data: { orderId: o1.orderId, paymentId: o1.paymentId, amount: '25.00', status: 'COMPLETED', destination: 'ORIGINAL_PAYMENT' } });
    await prisma.pgRefundRecord.create({ data: { refundId: refund.id, attemptId: a1, method: 'MANUAL_BANK', amountPaise: 2500, requestedById: 'u1', bankReference: 'RFND000001' } });
    await prisma.pgReconException.create({
      data: { kind: 'OVERCOLLECTION', restaurantId: A.restaurantId, attemptId: a1, orderId: o1.orderId, dedupeKey: `ov-${a1}`, detail: { reason: 'order already has a live payment' } },
    });
    // A2: observed, never bank confirmed
    const o2 = await order(A.branchId, { status: 'PAYMENT_PENDING', provider: 'youpi', payStatus: 'PENDING' });
    const a2 = await attempt(A, o2.orderId, o2.paymentId, 'OBSERVED', []);
    // B: other tenant, must not leak
    const ob = await order(B.branchId, { status: 'DELIVERED', provider: 'youpi' });
    await attempt(B, ob.orderId, ob.paymentId, 'CAPTURED', [['ORDER_PAYMENT', 10000, 'UTRB1000001']]);

    const rep = await buildPgReconciliationReport({ restaurantId: A.restaurantId, from: FROM, to: TO });
    expect(rep.settlementMode).toBe('DIRECT_TO_MERCHANT');
    expect(rep.rows.map((r) => r.attemptId).sort()).toEqual([a1, a2].sort());

    const r1 = rep.rows.find((r) => r.attemptId === a1)!;
    expect(r1).toMatchObject({
      orderId: o1.orderId, gatewayId: `gw-${o1.orderId}`, merchant: 'ea kitchen', receivingAccount: 'ea***@okbank / XXXX4321',
      utr: 'UTRA1000001', expectedAmountPaise: 10000, observedAmountPaise: 10000, bankConfirmedAmountPaise: 20000,
      reconStatus: 'CAPTURED', refundStatus: 'PARTIAL', refundedPaise: 2500, refundPendingPaise: 0, adjustmentsPaise: 10000,
      feesPaise: 0, platformCommissionPaise: 1000, netMerchantValuePaise: 20000 - 2500 - 0 - 1000,
      exceptionReason: 'OVERCOLLECTION: order already has a live payment',
    });
    for (const k of Object.keys(r1) as (keyof typeof r1)[]) {
      if (k.endsWith('Paise') && r1[k] != null) expect(Number.isInteger(r1[k])).toBe(true);
    }
    const r2 = rep.rows.find((r) => r.attemptId === a2)!;
    expect(r2).toMatchObject({ bankConfirmedAmountPaise: 0, platformCommissionPaise: 0, netMerchantValuePaise: 0, refundStatus: 'NONE', reconStatus: 'OBSERVED' });
    expect(rep.totals).toMatchObject({ bankConfirmedAmountPaise: 20000, refundedPaise: 2500, platformCommissionPaise: 1000, feesPaise: 0 });

    const csv = pgReconciliationCsv(rep);
    const lines = csv.split('\r\n');
    expect(lines[0]).toMatch(/^Order ID,Order code,/);
    expect(lines).toHaveLength(rep.rows.length + 2); // header + rows + trailing ''
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).not.toContain(',=HYPERLINK');
  });
});

describe('GMV report excludes unpaid PAYMENT_PENDING orders', () => {
  it('gmv-by-day counts paid/COD orders only', async () => {
    const t = await tenant('eg');
    const day = new Date('2032-07-07T10:00:00Z');
    for (const [status, total, method] of [['RECEIVED', 100, 'PHONEPE'], ['DELIVERED', 50, 'COD'], ['PAYMENT_PENDING', 200, 'PHONEPE'], ['PAYMENT_FAILED', 400, 'PHONEPE']] as const) {
      await prisma.order.create({
        data: { code: `G-${n++}`, branchId: t.branchId, customerId, subtotal: total as any, total: total as any, paymentMethod: method as any, status: status as any, placedAt: day },
      });
    }
    const res = await gmvByDay(new NextRequest('http://localhost/api/platform/reports/gmv-by-day?from=2032-07-07T00:00:00Z&to=2032-07-07T23:59:59Z'));
    const body = await res.text();
    expect(body).toContain('2032-07-07,2,150.00');
  });
});
