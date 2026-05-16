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
