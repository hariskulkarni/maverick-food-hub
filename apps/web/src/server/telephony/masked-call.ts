/**
 * Masked rider → customer calling.
 *
 * The rider taps "Call customer"; we ask the telephony provider to ring the
 * rider's phone first and, once answered, bridge it to the customer — both
 * legs show the ExoPhone, so neither side ever sees the other's number.
 *
 * Guarantees (each covered by __tests__/api/rider-call-customer.test.ts):
 *   - only the rider who owns an ACTIVE assignment (ACCEPTED / PICKED_UP,
 *     including "reached customer" and "customer unreachable") may call;
 *   - test riders / test customers never place a real call;
 *   - at most CALL_LIMIT_PER_ASSIGNMENT calls per assignment per window
 *     (DB-counted, so it survives restarts and works across instances);
 *   - responses, logs, audit rows and CallLog rows never contain a phone number.
 */
import type { CallLogStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { log } from '../log';
import { normalizePhone } from '../msg91-widget';
import { recordMaskedCall } from '../observability/hooks';
import { getTelephonyProvider } from './index';
import type { TelephonyProvider } from './types';
import { isE164 } from './phone';
import { TERMINAL_CALL_STATUSES, statusCallbackUrl, type ExotelStatusEvent } from './exotel';

export const CALL_LIMIT_PER_ASSIGNMENT = 3;
export const CALL_LIMIT_WINDOW_MS = 10 * 60_000;

const CALLABLE_ASSIGNMENT_STATUSES = new Set(['ACCEPTED', 'PICKED_UP']);
/** Orders past the point where a rider has any reason to phone the customer. */
const CLOSED_ORDER_STATUSES = new Set([
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_ADMIN',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
]);

const FALLBACK = 'use “Customer unreachable” to alert Flavrly support';

export const CALL_STARTED_MESSAGE = 'Calling you now — pick up to be connected';

export type CallCustomerResult =
  | { status: 200; body: { ok: true; callId: string; message: string } }
  | { status: number; body: { error: string; message: string }; retryAfterSec?: number };

function fail(status: number, error: string, message: string, retryAfterSec?: number): CallCustomerResult {
  return { status, body: { error, message }, ...(retryAfterSec ? { retryAfterSec } : {}) };
}

export async function requestCustomerCall(input: {
  userId: string;
  assignmentId: string;
  /** Injected in tests; defaults to the env-configured provider. */
  provider?: TelephonyProvider | null;
  ipAddress?: string | null;
  now?: Date;
}): Promise<CallCustomerResult> {
  const now = input.now ?? new Date();
  const profile = await prisma.riderProfile.findUnique({
    where: { userId: input.userId },
    select: { id: true, user: { select: { phone: true, isTestAccount: true } } },
  });
  const a = await prisma.riderAssignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      id: true,
      riderId: true,
      status: true,
      orderId: true,
      order: { select: { id: true, status: true, customer: { select: { phone: true, isTestAccount: true } } } },
    },
  });
  if (!a || !profile || a.riderId !== profile.id) return fail(404, 'not_found', 'This delivery was not found.');

  if (!CALLABLE_ASSIGNMENT_STATUSES.has(a.status) || CLOSED_ORDER_STATUSES.has(a.order.status)) {
    return fail(409, 'not_active', 'You can call the customer only while this delivery is active.');
  }

  if (profile.user?.isTestAccount || a.order.customer?.isTestAccount) {
    return fail(
      403,
      'test_account',
      'Test orders never place real phone calls. Masked calling is turned off for test riders and test customers.'
    );
  }

  const provider = input.provider === undefined ? getTelephonyProvider() : input.provider;
  if (!provider) {
    return fail(503, 'telephony_unavailable', `Calling through Flavrly isn’t set up yet. If you can’t find the customer, ${FALLBACK}.`);
  }

  const since = new Date(now.getTime() - CALL_LIMIT_WINDOW_MS);
  const recent = await prisma.callLog.findMany({
    where: { assignmentId: a.id, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (recent.length >= CALL_LIMIT_PER_ASSIGNMENT) {
    const resetAt = recent[0].createdAt.getTime() + CALL_LIMIT_WINDOW_MS;
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000));
    recordMaskedCall(provider.name, 'RATE_LIMITED');
    return fail(
      429,
      'rate_limited',
      `You’ve called this customer ${CALL_LIMIT_PER_ASSIGNMENT} times in 10 minutes. Try again in ${Math.ceil(retryAfterSec / 60)} min, or ${FALLBACK}.`,
      retryAfterSec
    );
  }

  const riderPhone = normalizePhone(profile.user?.phone);
  if (!isE164(riderPhone)) {
    return fail(422, 'rider_phone_missing', 'Your account has no valid phone number to ring. Contact Flavrly support.');
  }
  const customerPhone = normalizePhone(a.order.customer?.phone);
  if (!isE164(customerPhone)) {
    return fail(422, 'customer_phone_missing', 'We don’t have a reachable number for this customer. Use “Customer unreachable” to alert Flavrly support.');
  }

  const row = await prisma.callLog.create({
    data: {
      provider: provider.name,
      assignmentId: a.id,
      orderId: a.orderId,
      riderId: profile.id,
      initiatedById: input.userId,
    },
    select: { id: true },
  });

  const result = await provider.connectCall({
    from: riderPhone,
    to: customerPhone,
    statusCallbackUrl: statusCallbackUrl(row.id),
    correlationId: row.id,
  });

  if (!result.ok) {
    await prisma.callLog.update({
      where: { id: row.id },
      data: { status: 'FAILED', failureReason: result.reason, endedAt: now, lastEventAt: now },
    });
    // Reason is already number-free (redactPhones in the adapter).
    log.warn({ callLogId: row.id, provider: provider.name, httpStatus: result.httpStatus, reason: result.reason }, 'masked call request failed');
    recordMaskedCall(provider.name, 'FAILED');
    await audit('telephony.call.request', {
      actorId: input.userId,
      actorRole: 'RIDER',
      entityType: 'Order',
      entityId: a.orderId,
      after: { callLogId: row.id, assignmentId: a.id, provider: provider.name, outcome: 'FAILED' },
      ipAddress: input.ipAddress ?? null,
    });
    return fail(502, 'call_failed', `We couldn’t connect the call. Try again in a moment, or ${FALLBACK}.`);
  }

  await prisma.callLog.update({
    where: { id: row.id },
    data: { providerCallSid: result.providerCallSid, status: result.status, lastEventAt: now },
  });
  recordMaskedCall(provider.name, 'REQUESTED');
  await audit('telephony.call.request', {
    actorId: input.userId,
    actorRole: 'RIDER',
    entityType: 'Order',
    entityId: a.orderId,
    after: { callLogId: row.id, assignmentId: a.id, provider: provider.name, outcome: result.status },
    ipAddress: input.ipAddress ?? null,
  });
  return { status: 200, body: { ok: true, callId: row.id, message: CALL_STARTED_MESSAGE } };
}

/**
 * Apply a verified provider status event to its CallLog row. Idempotent:
 * duplicate deliveries rewrite the same values, and a late non-terminal event
 * never downgrades a row that already reached a terminal status.
 */
export async function applyCallStatusEvent(
  callLogId: string,
  ev: ExotelStatusEvent,
  now: Date = new Date()
): Promise<{ applied: boolean; reason?: string; status?: CallLogStatus }> {
  const row = await prisma.callLog.findUnique({
    where: { id: callLogId },
    select: { id: true, status: true, providerCallSid: true, provider: true, orderId: true, assignmentId: true },
  });
  if (!row) return { applied: false, reason: 'unknown_call' };
  // The signed URL names the row; the payload's CallSid must agree with it.
  if (ev.callSid && row.providerCallSid && ev.callSid !== row.providerCallSid) {
    return { applied: false, reason: 'sid_mismatch' };
  }
  const next = ev.status;
  const isTerminal = next ? TERMINAL_CALL_STATUSES.has(next) : false;
  const wasTerminal = TERMINAL_CALL_STATUSES.has(row.status);
  if (!isTerminal && wasTerminal) {
    return { applied: false, reason: 'already_terminal', status: row.status };
  }

  const data: Prisma.CallLogUpdateInput = { lastEventAt: now };
  if (next) data.status = next;
  if (ev.callSid && !row.providerCallSid) data.providerCallSid = ev.callSid;
  if (ev.durationSec != null) data.durationSec = ev.durationSec;
  if (ev.startedAt) data.startedAt = ev.startedAt;
  if (isTerminal) data.endedAt = ev.endedAt ?? now;
  if (ev.riderLegStatus) data.riderLegStatus = ev.riderLegStatus;
  if (ev.customerLegStatus) data.customerLegStatus = ev.customerLegStatus;
  await prisma.callLog.update({ where: { id: row.id }, data });

  if (isTerminal && !wasTerminal) {
    recordMaskedCall(row.provider, next!);
    await audit('telephony.call.status', {
      actorRole: 'SYSTEM',
      entityType: 'Order',
      entityId: row.orderId,
      after: { callLogId: row.id, assignmentId: row.assignmentId, status: next, durationSec: ev.durationSec },
    });
  }
  return { applied: true, status: next ?? row.status };
}

/** Super-admin DTO — ids, outcome and timings only; never a phone number. */
export interface CallLogDto {
  id: string;
  provider: string;
  direction: string;
  status: CallLogStatus;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  riderLegStatus: string | null;
  customerLegStatus: string | null;
  failureReason: string | null;
  order: { id: string; code: string };
  rider: { id: string; name: string | null };
}

export async function listCallLogs(filter: { orderId?: string; riderId?: string }, take = 50): Promise<CallLogDto[]> {
  const rows = await prisma.callLog.findMany({
    where: { ...(filter.orderId ? { orderId: filter.orderId } : {}), ...(filter.riderId ? { riderId: filter.riderId } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      provider: true,
      direction: true,
      status: true,
      durationSec: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      riderLegStatus: true,
      customerLegStatus: true,
      failureReason: true,
      order: { select: { id: true, code: true } },
      rider: { select: { id: true, user: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    direction: r.direction,
    status: r.status,
    durationSec: r.durationSec,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    riderLegStatus: r.riderLegStatus,
    customerLegStatus: r.customerLegStatus,
    failureReason: r.failureReason,
    order: { id: r.order.id, code: r.order.code },
    rider: { id: r.rider.id, name: r.rider.user?.name ?? null },
  }));
}
