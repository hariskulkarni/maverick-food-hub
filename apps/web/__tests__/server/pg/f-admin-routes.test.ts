/**
 * Agent F authz for Flavrly PG admin/platform routes (mocked Prisma; the real-DB versions of
 * the dual-control and onboarding rules live in tests/db/f-merchant.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  currentRestaurant: vi.fn(),
  accessibleSet: vi.fn(),
  audit: vi.fn(async () => undefined),
  acctFindFirst: vi.fn(),
  acctFindUnique: vi.fn(),
  importStatementCsv: vi.fn(),
  enterManual: vi.fn(),
  approveManual: vi.fn(),
  propose: vi.fn(),
  approveAlloc: vi.fn(),
  resolveException: vi.fn(),
  testConfig: vi.fn(),
  approveRefund: vi.fn(),
  buildReport: vi.fn(),
}));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/tenancy', () => ({
  currentRestaurant: h.currentRestaurant,
  accessibleSet: h.accessibleSet,
  requireManagedRestaurant: vi.fn(async () => ({ id: 'r1', name: 'R1' })),
}));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({
  prisma: {
    pgReceivingAccount: { findFirst: h.acctFindFirst, findUnique: h.acctFindUnique, create: vi.fn(), updateMany: vi.fn() },
    restaurant: { findUnique: vi.fn(async () => ({ id: 'r1' })) },
    integrationCredential: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('@/server/integrations', () => ({ getConfig: vi.fn(), saveConfig: vi.fn(), testConfig: h.testConfig }));
vi.mock('@/server/alerts', () => ({ sendIntegrationAlert: vi.fn(async () => undefined) }));
vi.mock('@/server/pg/bank-ingest', () => ({
  importStatementCsv: h.importStatementCsv,
  enterManualBankTransaction: h.enterManual,
  approveManualBankTransaction: h.approveManual,
}));
vi.mock('@/server/pg/reconcile-engine', () => ({ proposeManualAllocation: h.propose, approveManualAllocation: h.approveAlloc }));
vi.mock('@/server/pg/exceptions', () => ({ resolveException: h.resolveException }));
vi.mock('@/server/pg/refunds', () => ({
  PgRefundError: class extends Error {},
  approvePgRefund: h.approveRefund,
  completePgRefund: vi.fn(),
  failPgRefund: vi.fn(),
}));
vi.mock('@/server/pg/reports', () => ({ buildPgReconciliationReport: h.buildReport, pgReconciliationCsv: () => 'a,b\n' }));

import { POST as statementsPOST } from '@/app/api/admin/pg/statements/route';
import { POST as accountsPOST } from '@/app/api/platform/youpi/accounts/route';
import { POST as accountActionPOST } from '@/app/api/platform/youpi/accounts/[id]/route';
import { POST as resolvePOST } from '@/app/api/platform/youpi/exceptions/[id]/resolve/route';
import { POST as entryPOST } from '@/app/api/platform/youpi/bank-entries/route';
import { POST as entryApprovePOST } from '@/app/api/platform/youpi/bank-entries/[id]/approve/route';
import { POST as proposePOST } from '@/app/api/platform/youpi/allocations/route';
import { POST as allocApprovePOST } from '@/app/api/platform/youpi/allocations/[proposalId]/approve/route';
import { POST as integrationTestPOST } from '@/app/api/admin/integrations/[provider]/test/route';
import { POST as refundPOST } from '@/app/api/admin/pg/refunds/[refundId]/route';
import { GET as reportGET } from '@/app/api/admin/pg/report/route';

const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) });
const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });

function asUser(role: string | null, tenantRole: string | null = role, id = 'u1') {
  h.auth.mockResolvedValue(role ? { user: { id, role } } : null);
  h.currentRestaurant.mockResolvedValue(role === 'ADMIN' || role === 'KITCHEN' ? { id: 'r1' } : null);
  h.accessibleSet.mockResolvedValue(new Map(tenantRole ? [['r1', { role: tenantRole }]] : []));
}

const csvBody = {
  receivingAccountId: 'acc-other',
  fileName: 'stmt.csv',
  content: 'Date,Ref,Credit\n01/10/2026,UTR1,10.00\n',
  mapping: { date: 'Date', reference: 'Ref', credit: 'Credit', dateFormat: 'DD/MM/YYYY' },
};

beforeEach(() => {
  vi.clearAllMocks();
  asUser('ADMIN');
});

describe('tenant statement upload', () => {
  it('KITCHEN is refused before any lookup', async () => {
    asUser('KITCHEN');
    const res = await statementsPOST(req(csvBody));
    expect(res.status).toBe(403);
    expect(h.acctFindFirst).not.toHaveBeenCalled();
    expect(h.importStatementCsv).not.toHaveBeenCalled();
  });
  it('another restaurant\'s receiving account -> 404, nothing imported', async () => {
    h.acctFindFirst.mockResolvedValue(null);
    const res = await statementsPOST(req(csvBody));
    expect(res.status).toBe(404);
    expect(h.acctFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'acc-other', restaurantId: 'r1' } }));
    expect(h.importStatementCsv).not.toHaveBeenCalled();
  });
  it('own account: imports as the caller and audits counts', async () => {
    h.acctFindFirst.mockResolvedValue({ id: 'acc1' });
    h.importStatementCsv.mockResolvedValue({ importId: 'imp1', duplicateFile: false, insertedCount: 1, duplicateCount: 0, conflictCount: 0, rejected: [] });
    const res = await statementsPOST(req({ ...csvBody, receivingAccountId: 'acc1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ insertedCount: 1, rejectedCount: 0 });
    expect(h.importStatementCsv).toHaveBeenCalledWith(expect.objectContaining({ receivingAccountId: 'acc1', uploadedById: 'u1' }));
    expect(h.audit).toHaveBeenCalledWith('pg.statement.import', expect.objectContaining({ restaurantId: 'r1', entityId: 'imp1' }));
  });
});

describe('platform PG routes are SUPER_ADMIN only', () => {
  const calls: [string, () => Promise<Response>][] = [
    ['create account', () => accountsPOST(req({}))],
    ['account action', () => accountActionPOST(req({ action: 'VERIFY', method: 'x', note: 'y' }), ctx('id', 'a1'))],
    ['resolve exception', () => resolvePOST(req({ resolution: 'x' }), ctx('id', 'e1'))],
    ['manual bank entry', () => entryPOST(req({}))],
    ['approve bank entry', () => entryApprovePOST(req({}), ctx('id', 't1'))],
    ['propose allocation', () => proposePOST(req({}))],
    ['approve allocation', () => allocApprovePOST(req({}), ctx('proposalId', 'p1'))],
  ];
  for (const role of ['ADMIN', 'KITCHEN', 'CUSTOMER']) {
    it(`${role} gets 403 on every platform route and no service runs`, async () => {
      asUser(role);
      for (const [, call] of calls) expect((await call()).status).toBe(403);
      for (const fn of [h.enterManual, h.approveManual, h.propose, h.approveAlloc, h.resolveException, h.acctFindUnique]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  }
  it('unauthenticated gets 401', async () => {
    asUser(null);
    for (const [, call] of calls) expect((await call()).status).toBe(401);
  });
});

describe('dual control through the platform routes', () => {
  beforeEach(() => asUser('SUPER_ADMIN', null, 'sa1'));

  it('self-approval of a manual bank entry -> 409 with the engine message', async () => {
    h.approveManual.mockRejectedValue(new Error('approveManualBankTransaction: approver must be a different user than the one who entered it'));
    const res = await entryApprovePOST(req({}), ctx('id', 't1'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/different user/);
    expect(h.approveManual).toHaveBeenCalledWith('t1', 'sa1');
    expect(h.audit).not.toHaveBeenCalled();
  });
  it('self-approval of a manual allocation -> 409', async () => {
    h.approveAlloc.mockRejectedValue(new Error('manual allocation requires a second approver different from the operator'));
    const res = await allocApprovePOST(req({}), ctx('proposalId', 'p1'));
    expect(res.status).toBe(409);
    expect(h.approveAlloc).toHaveBeenCalledWith({ proposalId: 'p1', approverId: 'sa1' });
  });
  it('verifying an account you created -> 409 SAME_PERSON', async () => {
    h.acctFindUnique.mockResolvedValue({ id: 'a1', restaurantId: 'r1', gatewayMerchantId: 'm1', status: 'PENDING_VERIFICATION', createdById: 'sa1' });
    const res = await accountActionPOST(req({ action: 'VERIFY', method: 'Penny-drop', note: 'checked' }), ctx('id', 'a1'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SAME_PERSON');
  });
  it('manual entry rejects a malformed amount before touching the service', async () => {
    const res = await entryPOST(req({ receivingAccountId: 'acc1', amount: '12.345', bankReference: 'UTR123456', valueAt: '2026-10-24T10:00' }));
    expect(res.status).toBe(400);
    expect(h.enterManual).not.toHaveBeenCalled();
  });
});

describe('integrations /test blocks YOUPI (T-03)', () => {
  it('YOUPI -> 403 and no outbound test is made', async () => {
    const r = { nextUrl: new URL('http://x/api/admin/integrations/YOUPI/test'), json: async () => ({ config: { baseUrl: 'http://169.254.169.254/' } }) } as any;
    const res = await integrationTestPOST(r, { params: Promise.resolve({ provider: 'YOUPI' }) });
    expect(res.status).toBe(403);
    expect(h.testConfig).not.toHaveBeenCalled();
  });
});

describe('merchant refund + report routes', () => {
  it('KITCHEN cannot act on refunds or export the report', async () => {
    asUser('KITCHEN');
    expect((await refundPOST(req({ action: 'APPROVE' }), ctx('refundId', 'rf1'))).status).toBe(403);
    expect((await reportGET(new Request('http://x/api?from=2026-10-01&to=2026-10-24'))).status).toBe(403);
    expect(h.approveRefund).not.toHaveBeenCalled();
    expect(h.buildReport).not.toHaveBeenCalled();
  });
  it('refund actions are scoped to the caller\'s restaurant', async () => {
    h.approveRefund.mockResolvedValue({ refundId: 'rf1', status: 'PENDING', approved: true });
    expect((await refundPOST(req({ action: 'APPROVE' }), ctx('refundId', 'rf1'))).status).toBe(200);
    expect(h.approveRefund).toHaveBeenCalledWith({ refundId: 'rf1', actor: { id: 'u1', role: 'ADMIN' }, scopeRestaurantId: 'r1' });
  });
  it('report: own restaurant only, bounded period, CSV attachment', async () => {
    h.buildReport.mockResolvedValue({});
    expect((await reportGET(new Request('http://x/api?from=2026-01-01&to=2026-10-24'))).status).toBe(400);
    expect((await reportGET(new Request('http://x/api?from=bad&to=2026-10-24'))).status).toBe(400);
    const res = await reportGET(new Request('http://x/api?from=2026-10-01&to=2026-10-24&restaurantId=r2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(h.buildReport.mock.calls[0][0].restaurantId).toBe('r1');
  });
});
