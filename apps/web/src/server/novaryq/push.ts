/**
 * Novaryq order push + cancel (CONTRACT §5) — a transactional outbox.
 *
 * Producers (orders.ts) call enqueueNovaryqPush / enqueueNovaryqCancel inside the
 * SAME transaction as the order status change. One NovaryqOrderSync row per
 * order is the outbox entry; the novaryq-worker job claims due rows with
 * FOR UPDATE SKIP LOCKED + a lease (the PgOutbox pattern) and calls Novaryq.
 * Novaryq's (tenant, source, externalRef) idempotency makes a re-push after a
 * crash or lease takeover return the same POS order, never a duplicate.
 *
 * Novaryq being down never blocks or fails a Flavrly order: enqueue is a DB
 * insert, and every network call happens in the worker.
 */
import { OrderStatus, Prisma, type FulfillmentType, type PaymentMethod } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { audit } from '../audit';
import { newLeaseOwner } from '../pg/job-lease';
import { NovaryqApiError, novaryqRequest } from './client';
import { loadNovaryqConfig, novaryqFlagOn, type NovaryqConfig } from './config';
import { sendNovaryqAlert } from './alerts';

export const PUSH_MAX_ATTEMPTS = 8;
const PUSH_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
export const PUSH_LEASE_MS = 2 * 60_000;
const BATCH = 25;

/** Delay after failed attempt number `attempts` (1-based): 30s, 2m, 10m, 30m, then 2h. */
export function pushBackoffMs(attempts: number): number {
  return PUSH_BACKOFF_MS[Math.min(Math.max(attempts, 1), PUSH_BACKOFF_MS.length) - 1];
}

type Tx = Prisma.TransactionClient;
const OPEN_STATES = ['PENDING', 'SENT', 'FAILED', 'DEAD'] as const;

/** Called in the transaction that puts an order into RECEIVED. Returns true when a row was queued. */
export async function enqueueNovaryqPush(tx: Tx, orderId: string, branchId: string): Promise<boolean> {
  if (!novaryqFlagOn()) return false;
  const link = await tx.novaryqLocationLink.findUnique({ where: { branchId }, select: { restaurantId: true } });
  if (!link) return false;
  const cfg = await loadNovaryqConfig(link.restaurantId);
  if (!cfg?.enabled) return false;
  const r = await tx.novaryqOrderSync.createMany({ data: [{ orderId, restaurantId: link.restaurantId }], skipDuplicates: true });
  return r.count === 1;
}

/**
 * Called in the transaction that cancels an order. If Novaryq itself voided the
 * order (webhook already recorded lastStatus VOIDED) there is nothing to send back.
 * A row still leased by an in-flight push is only claimed after its lease ends.
 */
export async function enqueueNovaryqCancel(tx: Tx, orderId: string): Promise<void> {
  if (!novaryqFlagOn()) return;
  await tx.novaryqOrderSync.updateMany({
    where: { orderId, state: { in: [...OPEN_STATES] }, lastStatus: 'VOIDED' },
    data: { state: 'CANCELLED', lastError: null },
  });
  await tx.novaryqOrderSync.updateMany({
    where: { orderId, state: { in: [...OPEN_STATES] } },
    data: { state: 'CANCEL_PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
}

// ── Payload (§2.1) ───────────────────────────────────────────────────────────

type Money = Prisma.Decimal | number | string;
export interface PushOrder {
  id: string;
  code: string;
  fulfillmentType: FulfillmentType;
  paymentMethod: PaymentMethod;
  subtotal: Money;
  discountAmount: Money;
  deliveryFee: Money;
  packagingFee: Money;
  taxAmount: Money;
  total: Money;
  walletApplied?: Money;
  loyaltyApplied?: Money;
  signupBonusApplied?: Money;
  reservationDepositApplied?: Money;
  customerNotes: string | null;
  customer: { name: string | null; phone: string | null } | null;
  address: { line1: string; line2: string | null; landmark: string | null; city: string; postalCode: string } | null;
  items: Array<{
    menuItemId: string | null;
    comboId: string | null;
    name: string;
    quantity: number;
    unitPrice: Money;
    notes: string | null;
    isFreebie: boolean;
    selectedVariantName: string | null;
    modifiersSummary: string | null;
  }>;
}

const money = (v: Money) => Number(v).toFixed(2);
const SERVICE_MODE: Record<FulfillmentType, string> = { DELIVERY: 'DELIVERY', PICKUP: 'TAKEOUT', DINE_IN: 'DINE_IN' };

/**
 * Builds the POST /orders body, or lists every line that has no Novaryq item code.
 * Line unitPrice already includes variant + modifier deltas (OrderItem contract), so
 * modifiers go as a 0.00 snapshot and the POS never adds them twice.
 * Flavrly-side credits (wallet, loyalty, signup bonus, reservation deposit) are folded
 * into `discount` so subtotal − discount + fees + tax = grandTotal = Order.total, and
 * `payment.amount` is exactly what is paid online / what the rider collects (QA-C3).
 */
export function buildOrderPayload(
  order: PushOrder,
  locationId: string,
  codeByMenuItem: Map<string, string>,
): { payload: Record<string, unknown> } | { unmapped: string[] } {
  const unmapped = order.items.filter((i) => !i.menuItemId || !codeByMenuItem.has(i.menuItemId)).map((i) => i.name);
  if (unmapped.length) return { unmapped };

  const lines = order.items.map((i) => {
    const mods = [i.selectedVariantName, ...(i.modifiersSummary ?? '').split(',')]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .map((name) => ({ name, unitPrice: '0.00', quantity: 1 }));
    const notes = [i.isFreebie ? 'Free gift' : null, i.notes].filter(Boolean).join(' · ');
    return {
      itemCode: codeByMenuItem.get(i.menuItemId!)!,
      quantity: i.quantity,
      unitPrice: money(i.unitPrice),
      ...(notes ? { notes: notes.slice(0, 500) } : {}),
      ...(mods.length ? { modifiers: mods } : {}),
    };
  });
  const a = order.address;
  const deliveryAddress =
    order.fulfillmentType === 'DELIVERY' && a
      ? [a.line1, a.line2, a.landmark, `${a.city} ${a.postalCode}`].filter(Boolean).join(', ').slice(0, 500)
      : undefined;
  const prepaid = order.paymentMethod !== 'COD';
  return {
    payload: {
      locationId,
      serviceMode: SERVICE_MODE[order.fulfillmentType],
      source: 'flavrly',
      externalRef: order.id,
      externalCode: order.code.slice(0, 32),
      customer: { name: order.customer?.name || 'Flavrly customer', ...(order.customer?.phone ? { phone: order.customer.phone } : {}) },
      ...(deliveryAddress ? { deliveryAddress } : {}),
      ...(order.customerNotes ? { notes: order.customerNotes.slice(0, 500) } : {}),
      lines,
      totals: {
        subtotal: money(order.subtotal),
        discount: money(
          [order.discountAmount, order.walletApplied, order.loyaltyApplied, order.signupBonusApplied, order.reservationDepositApplied]
            .reduce<number>((s, v) => s + Number(v ?? 0), 0),
        ),
        deliveryFee: money(order.deliveryFee),
        packagingFee: money(order.packagingFee),
        tax: money(order.taxAmount),
        grandTotal: money(order.total),
      },
      payment: { status: prepaid ? 'PREPAID' : 'UNPAID', method: order.paymentMethod, amount: money(order.total) },
      currency: 'INR',
    },
  };
}

// ── Worker ───────────────────────────────────────────────────────────────────

export interface ClaimedSync {
  id: string;
  orderId: string;
  restaurantId: string;
  state: string;
  attempts: number;
  novaryqOrderId: string | null;
}

export type SyncOutcome = 'sent' | 'cancelled' | 'retried' | 'failed' | 'dead' | 'lost';

async function claimDue(owner: string, limit: number, leaseMs: number): Promise<ClaimedSync[]> {
  return prisma.$queryRaw<ClaimedSync[]>`
    UPDATE "NovaryqOrderSync" AS s
    SET "leaseOwner" = ${owner},
        "leaseExpiresAt" = timezone('utc', now()) + ${leaseMs}::int * interval '1 millisecond',
        "attempts" = s."attempts" + 1,
        "updatedAt" = timezone('utc', now())
    WHERE s."id" IN (
      SELECT "id" FROM "NovaryqOrderSync"
      WHERE "state" IN ('PENDING', 'CANCEL_PENDING') AND "nextAttemptAt" <= timezone('utc', now())
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < timezone('utc', now()))
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING s."id", s."orderId", s."restaurantId", s."state"::text AS "state", s."attempts", s."novaryqOrderId"`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const fence = (row: ClaimedSync, owner: string) => ({ id: row.id, leaseOwner: owner, state: row.state as 'PENDING' | 'CANCEL_PENDING' });
const released = { leaseOwner: null, leaseExpiresAt: null };

async function settle(row: ClaimedSync, owner: string, data: Prisma.NovaryqOrderSyncUpdateManyMutationInput): Promise<boolean> {
  const r = await prisma.novaryqOrderSync.updateMany({ where: fence(row, owner), data: { ...data, ...released } });
  return r.count === 1;
}

async function fail(row: ClaimedSync, owner: string, error: string): Promise<SyncOutcome> {
  if (!(await settle(row, owner, { state: 'FAILED', lastError: error }))) return 'lost';
  const isCancel = row.state === 'CANCEL_PENDING';
  await sendNovaryqAlert({
    restaurantId: row.restaurantId,
    kind: isCancel ? 'cancel_failed' : 'push_failed',
    entityId: row.orderId,
    subject: isCancel ? 'A Flavrly cancellation could not be sent to Novaryq' : 'A Flavrly order could not be sent to Novaryq POS',
    text: `Order ${row.orderId}: ${error}\nFix it in Flavrly admin → POS integration, then press Replay.`,
  });
  return 'failed';
}

async function retryOrDie(row: ClaimedSync, owner: string, e: unknown): Promise<SyncOutcome> {
  const error = errText(e);
  log.warn({ syncId: row.id, orderId: row.orderId, attempts: row.attempts, err: error }, 'novaryq.push.attempt_failed');
  if (row.attempts >= PUSH_MAX_ATTEMPTS) {
    if (!(await settle(row, owner, { state: 'DEAD', lastError: error }))) return 'lost';
    await sendNovaryqAlert({
      restaurantId: row.restaurantId,
      kind: 'push_dead',
      entityId: row.orderId,
      subject: 'Novaryq sync gave up after 8 attempts',
      text: `Order ${row.orderId} (${row.state === 'CANCEL_PENDING' ? 'cancel' : 'push'}): ${error}\nReplay it from Flavrly admin → POS integration once Novaryq is reachable.`,
    });
    return 'dead';
  }
  const retryAfter = e instanceof NovaryqApiError ? e.retryAfterMs ?? 0 : 0;
  const ok = await settle(row, owner, { nextAttemptAt: new Date(Date.now() + Math.max(pushBackoffMs(row.attempts), retryAfter)), lastError: error });
  return ok ? 'retried' : 'lost';
}

async function pushOrder(row: ClaimedSync, owner: string, cfg: NovaryqConfig): Promise<SyncOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: row.orderId },
    include: {
      items: true,
      customer: { select: { name: true, phone: true } },
      address: { select: { line1: true, line2: true, landmark: true, city: true, postalCode: true } },
      branch: { select: { restaurantId: true, novaryqLink: { select: { novaryqLocationId: true, currency: true } } } },
    },
  });
  if (!order || order.branch.restaurantId !== row.restaurantId) return fail(row, owner, 'Order not found for this restaurant');
  const loc = order.branch.novaryqLink;
  if (!loc) return fail(row, owner, 'The order\'s branch is not mapped to a Novaryq location');
  if (loc.currency !== 'INR') return fail(row, owner, `Novaryq location currency is ${loc.currency}, not INR`);

  const ids = order.items.map((i) => i.menuItemId).filter((x): x is string => !!x);
  const links = await prisma.novaryqItemLink.findMany({
    where: { restaurantId: row.restaurantId, menuItemId: { in: ids } },
    select: { menuItemId: true, novaryqItemCode: true },
  });
  const built = buildOrderPayload(order as unknown as PushOrder, loc.novaryqLocationId, new Map(links.map((l) => [l.menuItemId, l.novaryqItemCode])));
  if ('unmapped' in built) return fail(row, owner, `Unmapped items: ${built.unmapped.join(', ')}`);

  let res: { status: number; data: { id?: string; orderNumber?: string | number } };
  try {
    res = await novaryqRequest(cfg, 'POST', '/orders', built.payload);
  } catch (e) {
    if (e instanceof NovaryqApiError && !e.retryable) {
      const codes = (e.body as { unknownItemCodes?: unknown } | null)?.unknownItemCodes;
      return fail(row, owner, Array.isArray(codes) ? `${e.message} (unknown item codes: ${codes.join(', ')})` : e.message);
    }
    return retryOrDie(row, owner, e);
  }
  const novaryqOrderId = res.data?.id ? String(res.data.id) : null;
  const novaryqOrderNumber = res.data?.orderNumber != null ? String(res.data.orderNumber) : null;
  if (await settle(row, owner, { state: 'SENT', novaryqOrderId, novaryqOrderNumber, lastError: null })) return 'sent';
  // A cancel arrived while the push was in flight: keep CANCEL_PENDING, record the id, run the cancel now.
  const r = await prisma.novaryqOrderSync.updateMany({
    where: { id: row.id, leaseOwner: owner },
    data: { novaryqOrderId, novaryqOrderNumber, nextAttemptAt: new Date(), ...released },
  });
  return r.count === 1 ? 'sent' : 'lost';
}

const CANCEL_REASON: Partial<Record<OrderStatus, string>> = {
  CANCELLED_BY_CUSTOMER: 'customer_cancelled',
  CANCELLED_BY_RESTAURANT: 'restaurant_cancelled',
  CANCELLED_BY_ADMIN: 'admin_cancelled',
};

async function cancelOrder(row: ClaimedSync, owner: string, cfg: NovaryqConfig): Promise<SyncOutcome> {
  const order = await prisma.order.findUnique({ where: { id: row.orderId }, select: { status: true, code: true } });
  try {
    let novaryqOrderId = row.novaryqOrderId;
    if (!novaryqOrderId) {
      const found = await novaryqRequest<{ data?: Array<{ id: string }> }>(
        cfg, 'GET', `/orders?externalRef=${encodeURIComponent(row.orderId)}&source=flavrly`,
      );
      novaryqOrderId = found.data?.data?.[0]?.id ?? null;
      if (!novaryqOrderId) {
        return (await settle(row, owner, { state: 'CANCELLED', lastError: null })) ? 'cancelled' : 'lost';
      }
    }
    await novaryqRequest(cfg, 'POST', `/orders/${encodeURIComponent(novaryqOrderId)}/cancel`, {
      reason: (order && CANCEL_REASON[order.status]) ?? 'other',
      note: `Cancelled on Flavrly${order ? ` (${order.code})` : ''}`,
    });
    return (await settle(row, owner, { state: 'CANCELLED', novaryqOrderId, lastError: null })) ? 'cancelled' : 'lost';
  } catch (e) {
    if (e instanceof NovaryqApiError && !e.retryable) return fail(row, owner, e.message);
    return retryOrDie(row, owner, e);
  }
}

/** Handles one claimed row. Exported for unit tests; the worker is runNovaryqPushWorker. */
export async function processClaimed(row: ClaimedSync, owner: string): Promise<SyncOutcome> {
  if (row.attempts > PUSH_MAX_ATTEMPTS) return retryOrDie(row, owner, new Error('Attempt budget exhausted (worker crashed or lease expired)'));
  try {
    const cfg = await loadNovaryqConfig(row.restaurantId);
    if (!cfg?.enabled) return retryOrDie(row, owner, new Error('Novaryq is not configured or is disabled for this restaurant'));
    return row.state === 'CANCEL_PENDING' ? await cancelOrder(row, owner, cfg) : await pushOrder(row, owner, cfg);
  } catch (e) {
    return retryOrDie(row, owner, e);
  }
}

export interface PushRunResult { claimed: number; sent: number; cancelled: number; retried: number; failed: number; dead: number }

/** Drains due push/cancel rows until none are due or `maxMs` elapses. */
export async function runNovaryqPushWorker(opts: { leaseMs?: number; batch?: number; maxMs?: number } = {}): Promise<PushRunResult> {
  const owner = newLeaseOwner('novaryq-push');
  const deadline = Date.now() + (opts.maxMs ?? 40_000);
  const out: PushRunResult = { claimed: 0, sent: 0, cancelled: 0, retried: 0, failed: 0, dead: 0 };
  while (Date.now() < deadline) {
    const rows = await claimDue(owner, opts.batch ?? BATCH, opts.leaseMs ?? PUSH_LEASE_MS);
    if (rows.length === 0) break;
    out.claimed += rows.length;
    for (const row of rows) {
      const o = await processClaimed(row, owner);
      if (o !== 'lost') out[o] += 1;
    }
  }
  if (out.retried || out.failed || out.dead) log.warn({ ...out }, 'novaryq.push.run');
  return out;
}

/** Admin "Replay": a FAILED/DEAD row of this restaurant goes back in the queue, due now. */
export async function replaySync(restaurantId: string, syncId: string, actorId: string): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const row = await prisma.novaryqOrderSync.findFirst({
    where: { id: syncId, restaurantId },
    select: { id: true, state: true, orderId: true, order: { select: { status: true } } },
  });
  if (!row) return { ok: false, error: 'Not found' };
  if (row.state !== 'FAILED' && row.state !== 'DEAD') return { ok: false, error: `Only failed or dead syncs can be replayed (this one is ${row.state}).` };
  const status = row.order?.status;
  const cancelled = !!status && (status in CANCEL_REASON || status === OrderStatus.CANCELLED);
  const state = cancelled ? 'CANCEL_PENDING' : 'PENDING';
  const r = await prisma.novaryqOrderSync.updateMany({
    where: { id: syncId, restaurantId, state: { in: ['FAILED', 'DEAD'] } },
    data: { state, attempts: 0, nextAttemptAt: new Date(), lastError: null, ...released },
  });
  if (r.count !== 1) return { ok: false, error: 'The sync changed meanwhile; refresh and retry.' };
  await audit('integration.novaryq.replay', { actorId, restaurantId, entityType: 'NovaryqOrderSync', entityId: syncId, before: { state: row.state }, after: { state } });
  return { ok: true, state };
}
