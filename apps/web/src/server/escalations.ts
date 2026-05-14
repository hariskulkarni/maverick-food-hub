/**
 * Stuck-order detector. Scans orders against time thresholds per state and
 * creates OrderEscalation rows that surface on /platform/live-ops.
 *
 * Idempotent — won't create duplicate OPEN escalations for the same (order, type)
 * pair. Safe to run on a 1-minute cron or hit manually from /api/platform/escalations/scan.
 *
 * Thresholds (minutes), tunable via env:
 *   ESC_NOT_ACCEPTED_MIN=5            // RECEIVED with no accept
 *   ESC_PREPARING_OVER_MIN=10         // PREPARING beyond promised prep + this
 *   ESC_NO_RIDER_MIN=10               // READY without an assignment
 *   ESC_RIDER_NOT_MOVING_MIN=12       // PICKED_UP and last GPS ping > N min old
 *   ESC_OUT_FOR_DELIVERY_LATE_MIN=20  // OUT_FOR_DELIVERY beyond expected ETA + this
 *   ESC_PAYMENT_WEBHOOK_MIN=10        // PAYMENT_PENDING beyond this
 */
import { prisma } from './db';
import { OrderStatus } from '@prisma/client';

function envMin(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const T = {
  notAccepted:      envMin('ESC_NOT_ACCEPTED_MIN', 5),
  preparingOver:    envMin('ESC_PREPARING_OVER_MIN', 10),
  noRider:          envMin('ESC_NO_RIDER_MIN', 10),
  riderNotMoving:   envMin('ESC_RIDER_NOT_MOVING_MIN', 12),
  outForDelivLate:  envMin('ESC_OUT_FOR_DELIVERY_LATE_MIN', 20),
  paymentWebhook:   envMin('ESC_PAYMENT_WEBHOOK_MIN', 10)
};

async function open(orderId: string, type: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', message: string) {
  // Idempotency: don't create a duplicate OPEN row for the same order/type
  const existing = await prisma.orderEscalation.findFirst({
    where: { orderId, type: type as any, status: 'OPEN' }
  });
  if (existing) return existing;
  return prisma.orderEscalation.create({
    data: { orderId, type: type as any, severity: severity as any, message }
  });
}

export async function runEscalationScan(): Promise<{ created: number; checked: number }> {
  const now = new Date();
  let created = 0;
  let checked = 0;

  // 1) PAYMENT_PENDING orders sitting too long
  const stalePayments = await prisma.order.findMany({
    where: { status: OrderStatus.PAYMENT_PENDING, placedAt: { lt: new Date(now.getTime() - T.paymentWebhook * 60_000) } },
    select: { id: true, code: true, placedAt: true }
  });
  checked += stalePayments.length;
  for (const o of stalePayments) {
    const ageMin = Math.round((+now - +o.placedAt) / 60_000);
    const r = await open(o.id, 'PAYMENT_WEBHOOK_DELAY', 'HIGH', `Payment pending for ${ageMin}m on ${o.code}`);
    if (r.createdAt.getTime() > now.getTime() - 5_000) created++;
  }

  // 2) RECEIVED with no accept
  const notAccepted = await prisma.order.findMany({
    where: { status: OrderStatus.RECEIVED, placedAt: { lt: new Date(now.getTime() - T.notAccepted * 60_000) } },
    select: { id: true, code: true, placedAt: true }
  });
  checked += notAccepted.length;
  for (const o of notAccepted) {
    const ageMin = Math.round((+now - +o.placedAt) / 60_000);
    const sev = ageMin > 15 ? 'CRITICAL' : ageMin > 10 ? 'HIGH' : 'MEDIUM';
    const r = await open(o.id, 'ORDER_NOT_ACCEPTED', sev as any, `${o.code} not accepted in ${ageMin}m`);
    if (r.createdAt.getTime() > now.getTime() - 5_000) created++;
  }

  // 3) PREPARING beyond promised prep + buffer (use 25 min default if items have no prepTimeMin)
  const preparing = await prisma.order.findMany({
    where: { status: OrderStatus.PREPARING, preparingAt: { lt: new Date(now.getTime() - (25 + T.preparingOver) * 60_000) } },
    select: { id: true, code: true, preparingAt: true }
  });
  checked += preparing.length;
  for (const o of preparing) {
    const ageMin = Math.round((+now - +(o.preparingAt ?? now)) / 60_000);
    const r = await open(o.id, 'KITCHEN_DELAY', ageMin > 40 ? 'HIGH' : 'MEDIUM', `${o.code} in kitchen for ${ageMin}m`);
    if (r.createdAt.getTime() > now.getTime() - 5_000) created++;
  }

  // 4) READY but no rider claimed within window
  const noRider = await prisma.order.findMany({
    where: {
      status: OrderStatus.READY,
      readyAt: { lt: new Date(now.getTime() - T.noRider * 60_000) },
      assignment: null
    },
    select: { id: true, code: true, readyAt: true }
  });
  checked += noRider.length;
  for (const o of noRider) {
    const ageMin = Math.round((+now - +(o.readyAt ?? now)) / 60_000);
    const r = await open(o.id, 'NO_RIDER_AVAILABLE', ageMin > 20 ? 'CRITICAL' : 'HIGH', `${o.code} ready, no rider after ${ageMin}m`);
    if (r.createdAt.getTime() > now.getTime() - 5_000) created++;
  }

  // 5) Rider assigned but not moving — proxy via last DeliveryLocationPing age
  const inFlight = await prisma.order.findMany({
    where: { status: { in: [OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY] } },
    select: { id: true, code: true, outForDeliveryAt: true, assignment: { select: { riderId: true } } }
  });
  for (const o of inFlight) {
    if (!o.assignment?.riderId) continue;
    checked++;
    const lastPing = await prisma.deliveryLocationPing.findFirst({
      where: { riderId: o.assignment.riderId, orderId: o.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });
    const lastAt = lastPing?.createdAt ?? o.outForDeliveryAt;
    if (!lastAt) continue;
    const minutesSince = (+now - +lastAt) / 60_000;
    if (minutesSince >= T.riderNotMoving) {
      const r = await open(o.id, 'RIDER_NOT_MOVING', minutesSince > 25 ? 'CRITICAL' : 'HIGH', `${o.code}: no rider GPS for ${Math.round(minutesSince)}m`);
      if (r.createdAt.getTime() > now.getTime() - 5_000) created++;
    }
  }

  return { created, checked };
}

/** Close any OPEN escalations for an order — call from order transitions. */
export async function resolveOrderEscalations(orderId: string, resolvedBy?: string) {
  await prisma.orderEscalation.updateMany({
    where: { orderId, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: resolvedBy ?? null }
  });
}
