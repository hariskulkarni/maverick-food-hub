/**
 * Agent H (independent QA) real-DB helpers. Nothing here mocks Postgres: only the gateway
 * HTTP (global fetch) is stubbed by the tests that import this. Webhooks are signed with
 * real HMACs exactly as src/server/pg/webhook-auth.ts verifies them.
 *
 * Import AFTER the test file's vi.mock() block and after INTEGRATION_ENCRYPTION_KEY is set.
 */
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { OrderStatus, PaymentMethod, PgAttemptState, type PgReceivingAccount } from '@prisma/client';
import { prisma } from '@/server/db';
import { saveConfig } from '@/server/integrations';
import { POST as webhookPOST } from '@/app/api/payments/youpi/webhook/route';
import type { StatementColumnMapping } from '@/server/pg/bank-source';

export { prisma };
export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const PLATFORM_ID = '__platform__';
// Loopback gateway, as in the documented production topology (security.ts allows it only with the flag).
export const PLATFORM_BASE = 'http://127.0.0.1:6199';
process.env.FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY = 'true';
/** gatewayMerchantId -> receiving VPA the stub gateway reports in its private readback. */
export const merchantVpa = new Map<string, string>();
/** Sessions the stub gateway has created (paymentId -> private view). */
export const gatewaySessions = new Map<string, Record<string, unknown>>();
/** Global gateway fault switches for the fetch stub. */
export const gatewayFlags = { createDown: false };
export const PLATFORM_MERCHANT = 'platform-merchant-h';
export const PLATFORM_SECRET = 'fake-platform-webhook-secret-h';

/** One platform credential row (IntegrationCredential.restaurantId FK needs a Restaurant row). */
export async function ensurePlatform() {
  const exists = await prisma.restaurant.findUnique({ where: { id: PLATFORM_ID } });
  if (!exists) {
    const owner = await prisma.user.create({ data: { email: `platform-${uid()}@example.test`, role: 'SUPER_ADMIN' } });
    await prisma.restaurant.create({ data: { id: PLATFORM_ID, slug: `platform-${uid()}`, name: 'Platform', ownerUserId: owner.id } });
  }
  await saveConfig(PLATFORM_ID, 'YOUPI', {
    baseUrl: PLATFORM_BASE,
    merchantId: PLATFORM_MERCHANT,
    webhookSecret: PLATFORM_SECRET,
  });
}

export interface Tenant {
  restaurantId: string;
  branchId: string;
  customerId: string;
  ownerId: string;
  account: PgReceivingAccount;
  secret: string;
}

/** Restaurant + branch + VERIFIED receiving account + APPROVED feature + per-restaurant YOUPI creds. */
export async function makeTenant(): Promise<Tenant> {
  await ensurePlatform();
  const id = uid();
  const owner = await prisma.user.create({ data: { email: `owner-${id}@example.test`, role: 'ADMIN' } });
  const customer = await prisma.user.create({ data: { email: `cust-${id}@example.test`, role: 'CUSTOMER' } });
  const r = await prisma.restaurant.create({ data: { slug: `h-${id}`, name: `H ${id}`, ownerUserId: owner.id } });
  const b = await prisma.branch.create({
    data: { restaurantId: r.id, name: 'Main', slug: `hb-${id}`, line1: 'x', city: 'Pune', postalCode: '411001' },
  });
  const vpa = `shop${id}@bank`;
  const account = await prisma.pgReceivingAccount.create({
    data: {
      restaurantId: r.id,
      gatewayMerchantId: `m-${id}`,
      vpa,
      vpaNormalized: vpa,
      accountFingerprint: `fp-${id}`,
      legalEntityName: 'Test Foods Pvt Ltd',
      status: 'VERIFIED',
    },
  });
  await prisma.youpiFeatureRequest.create({ data: { restaurantId: r.id, status: 'APPROVED' } });
  merchantVpa.set(account.gatewayMerchantId, vpa);
  const secret = `fake-restaurant-secret-${id}`;
  await saveConfig(r.id, 'YOUPI', { merchantId: account.gatewayMerchantId, webhookSecret: secret, receivingVpa: vpa });
  return { restaurantId: r.id, branchId: b.id, customerId: customer.id, ownerId: owner.id, account, secret };
}

export function inr(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** PAYMENT_PENDING order (+ its PAYMENT_PENDING status event, as placeOrder writes it). */
export async function makePendingOrder(t: Tenant, amountPaise: number, createdAt?: Date) {
  const amount = inr(amountPaise);
  return prisma.order.create({
    data: {
      code: `H-${uid()}`,
      branchId: t.branchId,
      customerId: t.customerId,
      status: OrderStatus.PAYMENT_PENDING,
      subtotal: amount,
      total: amount,
      paymentMethod: PaymentMethod.RAZORPAY,
      ...(createdAt ? { createdAt } : {}),
      statusEvents: { create: [{ status: OrderStatus.PAYMENT_PENDING, note: 'Awaiting bank-verified Flavrly PG payment' }] },
    },
  });
}

/**
 * What a payable session leaves behind (Agent A's attempts.ts is not on pg/lead, so this mirrors
 * contract D8): youpi Payment PENDING + PgPaymentAttempt AWAITING_PAYMENT, attemptKey <orderId>-<id>.
 */
export async function makeSession(
  t: Tenant,
  orderId: string,
  amountPaise: number,
  opts: { createdAt?: Date; state?: PgAttemptState } = {},
) {
  const gatewayPaymentId = `gp_${uid()}`;
  const payment = await prisma.payment.create({
    data: {
      orderId,
      method: PaymentMethod.RAZORPAY,
      amount: inr(amountPaise),
      providerName: 'youpi',
      providerRef: gatewayPaymentId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  const attemptKey = `${orderId}-${uid()}`;
  const attempt = await prisma.pgPaymentAttempt.create({
    data: {
      paymentId: payment.id,
      orderId,
      restaurantId: t.restaurantId,
      receivingAccountId: t.account.id,
      attemptKey,
      idempotencyKey: attemptKey,
      gatewayMerchantId: t.account.gatewayMerchantId,
      gatewayPaymentId,
      expectedAmountPaise: amountPaise,
      state: opts.state ?? PgAttemptState.AWAITING_PAYMENT,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  return { payment, attempt, gatewayPaymentId, attemptKey };
}

// ───────────────────────────── webhook signing ─────────────────────────────

export interface Signed {
  raw: string;
  headers: Record<string, string>;
}

/** Upstream YouPI X-Gateway-Signature-V2: hex HMAC-SHA256(utf8 secret, "<ts>.<raw>"). */
export function signV2(
  body: Record<string, unknown>,
  secret: string,
  opts: { tsSec?: number; deliveryId?: string; headerDeliveryId?: string; bodyTimestamp?: string | null; event?: string } = {},
): Signed {
  const ts = String(opts.tsSec ?? Math.floor(Date.now() / 1000));
  const deliveryId = opts.deliveryId ?? `dlv_${uid()}`;
  const full = {
    deliveryId,
    ...(opts.bodyTimestamp === null ? {} : { timestamp: opts.bodyTimestamp ?? ts }),
    ...body,
  };
  const raw = JSON.stringify(full);
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${ts}.${raw}`).digest('hex');
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-gateway-signature-v2': `sha256=${sig}`,
      'x-gateway-timestamp': ts,
      'x-gateway-delivery-id': opts.headerDeliveryId ?? deliveryId,
      ...(opts.event ? { 'x-gateway-event': opts.event } : {}),
    },
  };
}

/** Standard Webhooks: base64 HMAC-SHA256(key, "<id>.<ts>.<raw>"). */
export function signStandard(body: Record<string, unknown>, secret: string, opts: { id?: string; tsSec?: number } = {}): Signed {
  const id = opts.id ?? `msg_${uid()}`;
  const ts = String(opts.tsSec ?? Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return {
    raw,
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
  };
}

export async function postWebhook(s: Signed): Promise<Response> {
  const req = new NextRequest('http://localhost/api/payments/youpi/webhook', {
    method: 'POST',
    headers: s.headers,
    body: s.raw,
  });
  return webhookPOST(req);
}

/** Wait until the route's best-effort inline processing released its lease (or never claimed). */
export async function settleInbox(providerEventId: string, maxMs = 10_000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const ev = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
    if (!ev || ev.processed || ev.deadLetteredAt || (ev.leaseOwner === null && ev.attempts > 0)) return ev;
    await sleep(25);
  }
  throw new Error(`inbox event ${providerEventId} did not settle`);
}

// ───────────────────────────── gateway stub ─────────────────────────────

export type GatewayStatus = { status: string; amountPaise?: number; utr?: string } | 'DOWN' | 'HTTP500';

/**
 * Fetch stub for the gateway: POST /api/v1/payments (create), GET /api/v1/payments/{id} (private view),
 * GET /api/v1/orders/{orderId}/cod (lookup). `table` overrides the status of a paymentId.
 */
export function gatewayFetch(table: Map<string, GatewayStatus>, calls: string[] = []) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (!url.startsWith(PLATFORM_BASE)) throw new Error(`unexpected outbound fetch ${url}`);
    const path = url.slice(PLATFORM_BASE.length);
    const hdr = new Headers(init?.headers);
    if (method === 'POST' && path === '/api/v1/payments') {
      if (gatewayFlags.createDown) throw new TypeError('fetch failed (ETIMEDOUT)');
      const body = JSON.parse(String(init?.body ?? '{}')) as { orderId: string; amount: string };
      const paymentId = `gp_${uid()}`;
      const [r, p = '0'] = body.amount.split('.');
      const amountPaise = Number(r) * 100 + Number(p.padEnd(2, '0'));
      gatewaySessions.set(paymentId, {
        paymentId, orderId: body.orderId, amountPaise: String(amountPaise), currency: 'INR', status: 'ACTIVE',
        metadata: { receivingAccountSnapshot: { upiId: merchantVpa.get(hdr.get('X-Merchant-Id') ?? '') ?? '' } },
      });
      return Response.json({ paymentId, orderId: body.orderId, amountPaise: String(amountPaise), currency: 'INR', status: 'ACTIVE', checkoutUrl: `https://pay.example.test/c/${paymentId}` }, { status: 201 });
    }
    const m = path.match(/^\/api\/v1\/payments\/([^/?]+)$/);
    const o = path.match(/^\/api\/v1\/orders\/([^/?]+)\/cod$/);
    if (!m && !o) throw new Error(`unexpected gateway path ${method} ${path}`);
    let id = m ? decodeURIComponent(m[1]) : '';
    if (o) id = [...gatewaySessions.values()].find((v) => v.orderId === decodeURIComponent(o[1]))?.paymentId as string ?? '';
    const s = table.get(id);
    const base = gatewaySessions.get(id);
    if (s === 'DOWN') throw new TypeError('fetch failed (ECONNREFUSED)');
    if (s === 'HTTP500') return new Response('boom', { status: 500 });
    if (s === undefined && !base) return new Response('not found', { status: 404 });
    return Response.json({ paymentId: id, ...(base ?? {}), ...(s ?? {}) });
  };
}

// ───────────────────────────── statements ─────────────────────────────

export const MAPPING: StatementColumnMapping = {
  date: 'Txn Date',
  narration: 'Narration',
  reference: 'Ref No',
  credit: 'Credit',
  debit: 'Debit',
  dateFormat: 'DD/MM/YYYY',
};

/** Today's date in IST as DD/MM/YYYY (statement dates carry no time). */
export function istToday(offsetDays = 0): string {
  const d = new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function statementCsv(rows: { ref: string; creditPaise?: number; debitPaise?: number; date?: string; narration?: string }[]) {
  const lines = ['Bank Statement for A/C XXXX1234', 'Txn Date,Narration,Ref No,Credit,Debit'];
  for (const r of rows) {
    lines.push(
      [
        r.date ?? istToday(),
        `"${r.narration ?? `UPI/${r.ref}/payer@okbank`}"`,
        r.ref,
        r.creditPaise ? inr(r.creditPaise) : '',
        r.debitPaise ? inr(r.debitPaise) : '',
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** Every DB fact the money path writes for one order/attempt, for before/after equality checks. */
export async function snapshot(orderId: string) {
  const [order, payments, attempts, allocations, outbox, events, exceptions, statusEvents, evidence] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } }),
    prisma.payment.findMany({ where: { orderId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.pgPaymentAttempt.findMany({ where: { orderId }, select: { id: true, state: true, observedUtr: true }, orderBy: { id: 'asc' } }),
    prisma.pgAllocation.findMany({ where: { orderId }, select: { id: true, kind: true, bankTransactionId: true }, orderBy: { id: 'asc' } }),
    prisma.pgOutbox.findMany({ where: { aggregateId: orderId }, select: { id: true, status: true, topic: true }, orderBy: { id: 'asc' } }),
    prisma.pgFinancialEvent.findMany({ where: { orderId }, select: { kind: true }, orderBy: { createdAt: 'asc' } }),
    prisma.pgReconException.findMany({ where: { orderId }, select: { kind: true, dedupeKey: true }, orderBy: { dedupeKey: 'asc' } }),
    prisma.orderStatusEvent.findMany({ where: { orderId }, select: { status: true }, orderBy: { createdAt: 'asc' } }),
    prisma.pgPaymentEvidence.findMany({
      where: { attempt: { orderId } },
      select: { source: true, utr: true, dedupeKey: true },
      orderBy: { dedupeKey: 'asc' },
    }),
  ]);
  return { order, payments, attempts, allocations, outbox, events: events.map((e) => e.kind).sort(), exceptions, statusEvents, evidence };
}
