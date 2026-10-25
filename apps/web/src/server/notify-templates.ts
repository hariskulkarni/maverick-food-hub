/**
 * Composable, side-effect-only notification helpers that take a domain id
 * (orderId, userId, …) and do the look-up + dispatch internally.
 *
 * Every helper must:
 *   1. Tolerate missing data — return cleanly if the order/customer/phone is
 *      gone, the OTP isn't set, etc.
 *   2. Never throw. Caller code is in the order/transition hot path; a
 *      notification failure must not block or roll back the order.
 *   3. Use `notify.sms` (which already journals to NotificationLog).
 */

import { prisma } from './db';
import { notify } from './notifications';
import { log } from './log';
import { brand } from '@/lib/brand';

/**
 * Sends the customer their delivery handover OTP — fired when an order
 * transitions into OUT_FOR_DELIVERY. Customer reads this code aloud to the
 * rider on doorstep and the rider keys it into the app to close the loop.
 *
 * No-op if:
 *   - the order doesn't exist
 *   - the customer has no phone on file
 *   - there's no deliveryOtp on the order (legacy / dine-in)
 *   - the OTP has already been verified (idempotent on repeated transitions)
 */
export async function sendDeliveryOtpSms(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        deliveryOtp: true,
        deliveryOtpVerified: true,
        customer: { select: { id: true, phone: true } },
        branch: { select: { restaurantId: true } }
      }
    });

    if (!order) {
      log.warn({ orderId }, 'sendDeliveryOtpSms: order not found');
      return;
    }
    if (!order.customer?.phone) {
      log.info({ orderId }, 'sendDeliveryOtpSms: no customer phone, skipping');
      return;
    }
    if (!order.deliveryOtp) {
      log.info({ orderId }, 'sendDeliveryOtpSms: no deliveryOtp, skipping');
      return;
    }
    if (order.deliveryOtpVerified) {
      log.info({ orderId }, 'sendDeliveryOtpSms: otp already verified, skipping');
      return;
    }

    const body =
      `Your delivery code is ${order.deliveryOtp}. ` +
      `Share only with your ${brand.name} rider. Order ${order.code}.`;

    await notify.sms({
      to: order.customer.phone,
      body,
      template: 'delivery.otp',
      userId: order.customer.id,
      restaurantId: order.branch.restaurantId
    });
  } catch (e) {
    // Best-effort: log and swallow. The order transition must not be rolled
    // back because the OTP SMS failed — the rider can also read the OTP off
    // their assignment screen as a fallback.
    log.error(
      { err: (e as Error).message, orderId },
      'sendDeliveryOtpSms failed'
    );
  }
}

/** Max SMS recipients for one SOS — bounds cost/abuse if contacts pile up. */
const SOS_MAX_RECIPIENTS = 5;

/** Builds the SOS SMS body. Pure — exported for tests. */
export function formatSosSms(a: { riderName: string; at: Date; lat: number | null; lng: number | null }): string {
  const time = a.at.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const where =
    a.lat != null && a.lng != null
      ? ` Location: https://maps.google.com/?q=${a.lat.toFixed(6)},${a.lng.toFixed(6)}`
      : ' Location not available.';
  return `${brand.name} SOS: ${a.riderName} triggered an emergency alert at ${time} IST.${where} Please call them now; dial 112 if needed.`;
}

/**
 * Texts the rider's emergency contacts when an SOS alert is raised. Recipients
 * are every RiderEmergencyContact plus RiderPreferences.emergencyPhone,
 * de-duplicated and capped. The ops-side SosAlert row is created by the caller;
 * this only adds the SMS fan-out. Never throws.
 */
export async function sendSosToEmergencyContacts(alertId: string): Promise<{ sent: number }> {
  try {
    const alert = await prisma.sosAlert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        lat: true,
        lng: true,
        triggeredAt: true,
        rider: {
          select: {
            userId: true,
            user: { select: { name: true, phone: true } },
            emergencyContacts: { select: { phone: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
            preferences: { select: { emergencyPhone: true } }
          }
        }
      }
    });
    if (!alert?.rider) return { sent: 0 };
    const r = alert.rider;
    const phones: string[] = [];
    for (const p of [...r.emergencyContacts.map((c) => c.phone), r.preferences?.emergencyPhone ?? null]) {
      const t = p?.trim();
      if (t && !phones.includes(t)) phones.push(t);
    }
    if (phones.length === 0) {
      log.info({ alertId }, 'sendSosToEmergencyContacts: no emergency contacts configured');
      return { sent: 0 };
    }
    const riderName = r.user?.name?.trim() || `Your ${brand.name} rider${r.user?.phone ? ` (${r.user.phone})` : ''}`;
    const body = formatSosSms({ riderName, at: alert.triggeredAt, lat: alert.lat, lng: alert.lng });
    let sent = 0;
    for (const to of phones.slice(0, SOS_MAX_RECIPIENTS)) {
      try {
        const res = await notify.sms({ to, body, template: 'rider.sos.emergency_contact', userId: r.userId, meta: { sosAlertId: alert.id } });
        if (res?.ok) sent++;
      } catch (e) {
        log.error({ err: (e as Error).message, alertId }, 'sendSosToEmergencyContacts: sms failed');
      }
    }
    return { sent };
  } catch (e) {
    log.error({ err: (e as Error).message, alertId }, 'sendSosToEmergencyContacts failed');
    return { sent: 0 };
  }
}
