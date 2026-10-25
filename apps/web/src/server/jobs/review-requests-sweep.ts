/**
 * Review-requests sweep — sends due post-order review asks and their single
 * optional reminder. Runs every 5 minutes from
 * /api/platform/jobs/review-requests/run.
 *
 * Idempotency: every send is preceded by an atomic claim (updateMany guarded on
 * the current status / reminderAt IS NULL), so overlapping runs never send the
 * same ask or reminder twice. Claim-then-send means at-most-once delivery: a
 * provider failure marks the row FAILED instead of retrying into spam.
 *
 * Skips (status SKIPPED + reason in `error`): acquisition disabled, feedback
 * already given, customer opted out, frequency cap, no reachable contact,
 * ask went stale. Quiet hours defer (row stays due and is picked up later).
 */
import { prisma } from '../db';
import { log } from '../log';
import {
  loadAcquisitionConfig,
  isQuietHour,
  isStale,
  isOptedOut,
  hitsFrequencyCap,
  pickChannel,
  reminderDueAt,
  type AcquisitionConfig,
} from '../reviews/acquisition';
import { sendReviewAsk, whatsappReady } from '../reviews/review-request-send';

const BATCH = 200;

export interface ReviewRequestsSweepResult {
  due: number;
  sent: number;
  skipped: number;
  deferred: number;
  failed: number;
  reminders: number;
}

const requestInclude = {
  order: {
    select: {
      code: true,
      feedback: { select: { id: true } },
      customer: { select: { id: true, phone: true, email: true } },
    },
  },
  restaurant: { select: { name: true } },
} as const;

async function skip(id: string, reason: string) {
  await prisma.reviewRequest.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SKIPPED', error: reason } });
}

export async function runReviewRequestsSweep(now: Date = new Date()): Promise<ReviewRequestsSweepResult> {
  const out: ReviewRequestsSweepResult = { due: 0, sent: 0, skipped: 0, deferred: 0, failed: 0, reminders: 0 };
  const cfgCache = new Map<string, AcquisitionConfig>();
  const cfgFor = async (rid: string) => {
    if (!cfgCache.has(rid)) cfgCache.set(rid, await loadAcquisitionConfig(rid));
    return cfgCache.get(rid)!;
  };

  // ── 1. First asks ──────────────────────────────────────────────────────
  const due = await prisma.reviewRequest.findMany({
    where: { status: 'SCHEDULED', dueAt: { lte: now }, orderId: { not: null } },
    include: requestInclude,
    orderBy: { dueAt: 'asc' },
    take: BATCH,
  });
  out.due = due.length;

  for (const r of due) {
    try {
      const cfg = await cfgFor(r.restaurantId);
      const customer = r.order?.customer;
      let reason: string | null = null;
      if (!cfg.enabled) reason = 'disabled';
      else if (!r.order || !customer) reason = 'order_missing';
      else if (r.order.feedback) reason = 'feedback_exists';
      else if (r.dueAt && isStale(r.dueAt, now)) reason = 'stale';
      else if (await isOptedOut(customer.id, r.restaurantId)) reason = 'opted_out';
      else if (await hitsFrequencyCap({ customerId: customer.id, restaurantId: r.restaurantId, capDays: cfg.frequencyCapDays, excludeId: r.id, now })) reason = 'frequency_cap';
      if (reason) {
        await skip(r.id, reason);
        out.skipped++;
        continue;
      }
      if (isQuietHour(now, cfg.quietStartHour, cfg.quietEndHour)) {
        out.deferred++;
        continue;
      }
      const channel = pickChannel(cfg.channels, customer!, await whatsappReady(r.restaurantId, cfg));
      if (!channel) {
        await skip(r.id, 'no_contact');
        out.skipped++;
        continue;
      }
      // Atomic claim — only one sweep instance wins the row.
      const claim = await prisma.reviewRequest.updateMany({
        where: { id: r.id, status: 'SCHEDULED' },
        data: { status: 'SENT', sentAt: now, channel, reminderDueAt: reminderDueAt(now, cfg), error: null },
      });
      if (claim.count !== 1) continue;
      const res = await sendReviewAsk({
        kind: 'ask', channel, token: r.token, restaurantId: r.restaurantId,
        restaurantName: r.restaurant.name, orderCode: r.order!.code, customer: customer!, cfg,
      });
      if (res.ok) out.sent++;
      else {
        out.failed++;
        await prisma.reviewRequest.update({ where: { id: r.id }, data: { status: 'FAILED', error: (res.error ?? 'send failed').slice(0, 500), reminderDueAt: null } });
      }
    } catch (e) {
      out.failed++;
      log.error({ err: (e as Error).message, reviewRequestId: r.id }, 'review request send failed');
    }
  }

  // ── 2. Reminders (only for asks that were sent and not yet clicked) ─────
  const reminders = await prisma.reviewRequest.findMany({
    where: { status: 'SENT', reminderAt: null, reminderDueAt: { lte: now }, orderId: { not: null } },
    include: requestInclude,
    orderBy: { reminderDueAt: 'asc' },
    take: BATCH,
  });
  for (const r of reminders) {
    try {
      const cfg = await cfgFor(r.restaurantId);
      const customer = r.order?.customer;
      const drop =
        !cfg.enabled || !cfg.reminderEnabled || !customer || !!r.order?.feedback ||
        (r.reminderDueAt && isStale(r.reminderDueAt, now)) ||
        (await isOptedOut(customer.id, r.restaurantId));
      if (drop) {
        await prisma.reviewRequest.updateMany({ where: { id: r.id, reminderAt: null }, data: { reminderDueAt: null } });
        continue;
      }
      if (isQuietHour(now, cfg.quietStartHour, cfg.quietEndHour)) continue;
      const claim = await prisma.reviewRequest.updateMany({
        where: { id: r.id, status: 'SENT', reminderAt: null },
        data: { reminderAt: now },
      });
      if (claim.count !== 1) continue;
      const channel = r.channel === 'QR' ? 'SMS' : r.channel;
      const res = await sendReviewAsk({
        kind: 'reminder', channel, token: r.token, restaurantId: r.restaurantId,
        restaurantName: r.restaurant.name, orderCode: r.order!.code, customer: customer!, cfg,
      });
      if (res.ok) out.reminders++;
      else await prisma.reviewRequest.update({ where: { id: r.id }, data: { error: `reminder: ${(res.error ?? 'send failed').slice(0, 480)}` } });
    } catch (e) {
      log.error({ err: (e as Error).message, reviewRequestId: r.id }, 'review reminder failed');
    }
  }

  return out;
}
