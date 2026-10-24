/**
 * Real-Postgres proof (Agent F): receiving-account onboarding constraints, dual control through
 * the platform routes, tenant scoping of the merchant routes, and CRM side effects firing once
 * for a Flavrly PG order. Only auth/cookies and network/notification side effects are mocked.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeAll } from 'vitest';

const h = vi.hoisted(() => {
  // Dev-only key derivation for IntegrationCredential encryption in this disposable DB.
  process.env.NEXTAUTH_SECRET ||= 'ci-only-not-a-secret';
  return { session: null as null | { user: { id: string; role: string } } };
});
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => h.session) }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));

import { Prisma } from '@prisma/client';
import { prisma, makeAccount, makeAttempt, makeCredit, uid } from './fixtures';
import { getConfig, saveConfig } from '@/server/integrations';
import {
  ReceivingAccountError,
  changeReceivingAccountStatus,
  createReceivingAccount,
  verifyReceivingAccount,
} from '@/server/pg/receiving-accounts';
import { tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { handleOrderRelease } from '@/server/pg/fulfillment';
import { transitionOrder } from '@/server/orders';
import { POST as entryPOST } from '@/app/api/platform/youpi/bank-entries/route';
import { POST as entryApprovePOST } from '@/app/api/platform/youpi/bank-entries/[id]/approve/route';
import { POST as proposePOST } from '@/app/api/platform/youpi/allocations/route';
import { POST as allocApprovePOST } from '@/app/api/platform/youpi/allocations/[proposalId]/approve/route';
import { POST as statementsPOST } from '@/app/api/admin/pg/statements/route';
import { POST as vpaPOST } from '@/app/api/admin/youpi/vpa/route';

const ACCOUNT_NO = '001234567890123';
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) });
const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });
const as = (u: { id: string; role: string } | null) => {
  h.session = u ? { user: u } : null;
};

let sa1: { id: string; role: string };
let sa2: { id: string; role: string };

async function restaurant() {
  const id = uid();
  const owner = await prisma.user.create({ data: { email: `own-${id}@example.test`, role: 'ADMIN' } });
  const r = await prisma.restaurant.create({ data: { slug: `f-${id}`, name: `F ${id}`, ownerUserId: owner.id } });
  return { r, owner };
}
const input = (restaurantId: string, over: Partial<Record<string, string>> = {}) => ({
  restaurantId,
  gatewayMerchantId: `gm-${uid()}`,
  vpa: `shop${uid()}@okbank`,
  legalEntityName: 'Test Foods Pvt Ltd',
  ifsc: 'HDFC0001234',
  accountNumber: ACCOUNT_NO,
  ...over,
});
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof ReceivingAccountError) return e.code;
    throw e;
  }
}

beforeAll(async () => {
  const a = await prisma.user.create({ data: { email: `sa1-${uid()}@example.test`, role: 'SUPER_ADMIN' } });
  const b = await prisma.user.create({ data: { email: `sa2-${uid()}@example.test`, role: 'SUPER_ADMIN' } });
  sa1 = { id: a.id, role: a.role };
  sa2 = { id: b.id, role: b.role };
});

describe('receiving-account onboarding', () => {
  it('stores only a fingerprint + last4, never the raw account number; audited', async () => {
    const { r } = await restaurant();
    const acc = await createReceivingAccount(input(r.id), sa1);
    expect(acc.status).toBe('PENDING_VERIFICATION');
    expect(acc.accountLast4).toBe('0123');
    expect(acc.accountFingerprint).toBe(createHash('sha256').update(`HDFC0001234:${ACCOUNT_NO}`).digest('hex'));
    const raw = await prisma.$queryRaw<unknown[]>`SELECT * FROM "PgReceivingAccount" WHERE id = ${acc.id}`;
    expect(JSON.stringify(raw)).not.toContain(ACCOUNT_NO);
    const audits = await prisma.auditLog.findMany({ where: { entityId: acc.id } });
    expect(audits.map((x) => x.action)).toEqual(['pg.receiving_account.create']);
    expect(JSON.stringify(audits)).not.toContain(ACCOUNT_NO);
  });

  it('only a SUPER_ADMIN other than the creator can verify; method + note required', async () => {
    const { r, owner } = await restaurant();
    const acc = await createReceivingAccount(input(r.id), sa1);
    expect(await code(verifyReceivingAccount(acc.id, { method: 'Penny-drop', note: 'ok' }, sa1))).toBe('SAME_PERSON');
    expect(await code(verifyReceivingAccount(acc.id, { method: 'Penny-drop', note: 'ok' }, { id: owner.id, role: 'ADMIN' }))).toBe('FORBIDDEN');
    expect(await code(verifyReceivingAccount(acc.id, { method: 'Penny-drop', note: ' ' }, sa2))).toBe('INVALID_INPUT');
    const v = await verifyReceivingAccount(acc.id, { method: 'Penny-drop', note: 'bank letter matched' }, sa2);
    expect(v).toMatchObject({ status: 'VERIFIED', verifiedById: sa2.id, verificationMethod: 'Penny-drop' });
    // The verified VPA becomes the effective one for the legacy resolver.
    expect((await getConfig(r.id, 'YOUPI'))?.receivingVpa).toBe(v.vpa);
  });

  it('gateway merchant id already bound to another VERIFIED account -> clear error; DB index is the backstop', async () => {
    const a = await restaurant();
    const b = await restaurant();
    const gm = `gm-${uid()}`;
    const first = await createReceivingAccount(input(a.r.id, { gatewayMerchantId: gm }), sa1);
    await verifyReceivingAccount(first.id, { method: 'Penny-drop', note: 'ok' }, sa2);
    const second = await createReceivingAccount(input(b.r.id, { gatewayMerchantId: gm }), sa1);
    expect(await code(verifyReceivingAccount(second.id, { method: 'Penny-drop', note: 'ok' }, sa2))).toBe('GATEWAY_MERCHANT_ALREADY_BOUND');
    // Bypassing the service still fails at the partial unique index.
    await expect(prisma.pgReceivingAccount.update({ where: { id: second.id }, data: { status: 'VERIFIED' } })).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
    );
    // After suspending the first binding, the second can be verified; reconciliation of the first is unaffected.
    const s = await changeReceivingAccountStatus(first.id, 'SUSPEND', 'merchant moved to new entity', sa1);
    expect(s.status).toBe('SUSPENDED');
    expect(s.disabledForNewAt).not.toBeNull();
    expect((await verifyReceivingAccount(second.id, { method: 'Penny-drop', note: 'ok' }, sa2)).status).toBe('VERIFIED');
  });

  it('one VERIFIED account per restaurant; same VPA twice in one restaurant refused', async () => {
    const { r } = await restaurant();
    const vpa = `dup${uid()}@okbank`;
    const one = await createReceivingAccount(input(r.id, { vpa }), sa1);
    expect(await code(createReceivingAccount(input(r.id, { vpa: vpa.toUpperCase() }), sa1))).toBe('VPA_ALREADY_REGISTERED');
    await verifyReceivingAccount(one.id, { method: 'Penny-drop', note: 'ok' }, sa2);
    const two = await createReceivingAccount(input(r.id), sa1);
    expect(await code(verifyReceivingAccount(two.id, { method: 'Penny-drop', note: 'ok' }, sa2))).toBe('RESTAURANT_ALREADY_VERIFIED');
  });

  it('disable-for-new keeps VERIFIED; revoke is terminal; every change audited', async () => {
    const { r } = await restaurant();
    const acc = await createReceivingAccount(input(r.id), sa1);
    await verifyReceivingAccount(acc.id, { method: 'Penny-drop', note: 'ok' }, sa2);
    const d = await changeReceivingAccountStatus(acc.id, 'DISABLE_NEW', 'pilot paused', sa1);
    expect(d.status).toBe('VERIFIED');
    expect(d.disabledForNewAt).not.toBeNull();
    expect((await changeReceivingAccountStatus(acc.id, 'ENABLE_NEW', 'resumed', sa1)).disabledForNewAt).toBeNull();
    expect((await changeReceivingAccountStatus(acc.id, 'REVOKE', 'closed', sa1)).status).toBe('REVOKED');
    expect(await code(verifyReceivingAccount(acc.id, { method: 'x', note: 'y' }, sa2))).toBe('INVALID_STATE');
    expect(await code(changeReceivingAccountStatus(acc.id, 'SUSPEND', 'x', sa1))).toBe('INVALID_STATE');
    const actions = (await prisma.auditLog.findMany({ where: { entityId: acc.id }, orderBy: { createdAt: 'asc' } })).map((x) => x.action);
    expect(actions).toEqual([
      'pg.receiving_account.create',
      'pg.receiving_account.verify',
      'pg.receiving_account.disable_new',
      'pg.receiving_account.enable_new',
      'pg.receiving_account.revoke',
    ]);
  });
});

describe('dual control through the platform routes (real engine)', () => {
  it('manual bank entry: the enterer cannot approve; a second super admin can', async () => {
    const acc = await makeAccount();
    as(sa1);
    const ref = `UTR${uid().toUpperCase()}`;
    const res = await entryPOST(req({ receivingAccountId: acc.account.id, amount: '250.00', bankReference: ref, valueAt: '2026-10-24T10:00' }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await entryApprovePOST(req({}), ctx('id', id))).status).toBe(409);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_APPROVAL');
    as(sa2);
    const ok = await entryApprovePOST(req({}), ctx('id', id));
    expect(ok.status).toBe(200);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id } })).approvedById).toBe(sa2.id);
  });

  it('manual allocation: the proposer cannot approve; a second super admin captures', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc, { observedUtr: null });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: `REF${uid().toUpperCase()}` });
    as(sa1);
    const p = await proposePOST(req({ attemptId: attempt.id, bankTransactionId: credit.id, reason: 'customer screenshot + statement line' }));
    expect(p.status).toBe(201);
    const { proposalId } = (await p.json()) as { proposalId: string };
    expect((await allocApprovePOST(req({}), ctx('proposalId', proposalId))).status).toBe(409);
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(0);
    as(sa2);
    const ok = await allocApprovePOST(req({}), ctx('proposalId', proposalId));
    expect(await ok.json()).toMatchObject({ outcome: 'CAPTURED' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CAPTURED');
  });

  it('a restaurant ADMIN cannot reach the platform routes', async () => {
    const { owner } = await restaurant();
    as({ id: owner.id, role: 'ADMIN' });
    expect((await entryPOST(req({}))).status).toBe(403);
    expect((await proposePOST(req({}))).status).toBe(403);
  });
});

describe('tenant scoping of merchant routes', () => {
  it('statement upload for another restaurant\'s account -> 404, nothing imported', async () => {
    const mine = await restaurant();
    const other = await makeAccount();
    as({ id: mine.owner.id, role: 'ADMIN' });
    const res = await statementsPOST(
      req({
        receivingAccountId: other.account.id,
        fileName: 's.csv',
        content: 'Date,Ref,Credit\n01/10/2026,UTRX1,10.00\n',
        mapping: { date: 'Date', reference: 'Ref', credit: 'Credit', dateFormat: 'DD/MM/YYYY' },
      }),
    );
    expect(res.status).toBe(404);
    expect(await prisma.pgStatementImport.count({ where: { receivingAccountId: other.account.id } })).toBe(0);
  });

  it('statement upload for own account reports inserted/duplicate/rejected counts', async () => {
    const acc = await makeAccount();
    const owner = await prisma.restaurant.findUniqueOrThrow({ where: { id: acc.restaurant.id }, select: { ownerUserId: true } });
    as({ id: owner.ownerUserId!, role: 'ADMIN' });
    const ref = `UTR${uid().toUpperCase()}`;
    const body = {
      receivingAccountId: acc.account.id,
      fileName: 's.csv',
      content: `Bank statement\nDate,Ref,Credit\n01/10/2026,${ref},10.00\n02/10/2026,,5.00\n`,
      mapping: { date: 'Date', reference: 'Ref', credit: 'Credit', dateFormat: 'DD/MM/YYYY' },
    };
    const res = await statementsPOST(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicateFile: false, insertedCount: 1, rejectedCount: 1 });
    const again = await statementsPOST(req(body));
    expect(await again.json()).toMatchObject({ duplicateFile: true, insertedCount: 0 });
  });

  it('a user who is KITCHEN on the restaurant cannot request a VPA change', async () => {
    const { r } = await restaurant();
    await prisma.youpiFeatureRequest.create({ data: { restaurantId: r.id, status: 'APPROVED' } });
    await saveConfig(r.id, 'YOUPI', { receivingVpa: 'old@okbank' });
    const staff = await prisma.user.create({ data: { email: `k-${uid()}@example.test`, role: 'ADMIN' } });
    await prisma.restaurantUser.create({ data: { restaurantId: r.id, userId: staff.id, role: 'KITCHEN' } });
    as({ id: staff.id, role: 'ADMIN' });
    expect((await vpaPOST(req({ receivingVpa: 'new@okbank' }))).status).toBe(403);
    as({ id: staff.id, role: 'KITCHEN' });
    expect((await vpaPOST(req({ receivingVpa: 'new@okbank' }))).status).toBe(403);
    const cfg = await getConfig(r.id, 'YOUPI');
    expect(cfg?.receivingVpa).toBe('old@okbank');
    expect(cfg?.pendingReceivingVpa).toBeUndefined();
  });
});

describe('CRM: a Flavrly PG order earns loyalty exactly once', () => {
  it('duplicate allocation, duplicate release and concurrent DELIVERED award one EARN', async () => {
    const acc = await makeAccount();
    const utr = `UTR${uid().toUpperCase()}`;
    const { attempt, payment, orderId } = await makeAttempt(acc, { amountPaise: 25000, observedUtr: utr });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: utr });

    expect((await tryAllocateBankTxn(credit.id)).outcome).toBe('CAPTURED');
    expect((await tryAllocateBankTxn(credit.id)).outcome).toBe('ALREADY_ALLOCATED');
    const release = { orderId, attemptId: attempt.id, paymentId: payment.id };
    expect((await handleOrderRelease(release)).outcome).toBe('RELEASED');
    expect((await handleOrderRelease(release)).outcome).toBe('ALREADY_RELEASED');

    for (const s of ['ACCEPTED', 'PREPARING', 'READY'] as const) await transitionOrder(orderId, s);
    const results = await Promise.allSettled([transitionOrder(orderId, 'DELIVERED'), transitionOrder(orderId, 'DELIVERED')]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    await transitionOrder(orderId, 'DELIVERED'); // replay is a no-op

    const earns = await prisma.loyaltyTransaction.findMany({ where: { orderId, type: 'EARN' } });
    expect(earns).toHaveLength(1);
    expect(earns[0].points).toBe(10); // 5 pts per Rs 100 of Rs 250 subtotal
    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId: acc.customer.id } });
    expect(loyalty.lifetimeEarn).toBe(10);
  });

  it('an unpaid Flavrly PG order cannot reach DELIVERED, so it never earns', async () => {
    const acc = await makeAccount();
    const { orderId } = await makeAttempt(acc, { observedUtr: null });
    await expect(transitionOrder(orderId, 'RECEIVED')).rejects.toThrow(/bank-verified/);
    await expect(transitionOrder(orderId, 'DELIVERED')).rejects.toThrow();
    expect(await prisma.loyaltyTransaction.count({ where: { orderId } })).toBe(0);
  });
});
