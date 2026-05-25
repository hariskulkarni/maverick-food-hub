/**
 * Daily food-license (FSSAI) expiry sweep.
 *
 * Scans every active branch that has an expiry date and is within the warning
 * window (≤ 30 days out) OR already expired, and fires an admin alert (email +
 * SMS) via sendLicenseExpiryAlert. That sender debounces per branch so a branch
 * sitting in the window is reminded at most once every ~3 days, not daily.
 *
 * Triggered from /api/platform/jobs/food-license-expiry/run on a daily cron
 * (or on demand from the super-admin dashboard). Mirrors the KYC expiry sweep.
 */
import { prisma } from '../db';
import { log } from '../log';
import { licenseStatus, EXPIRY_WARN_DAYS } from '../food-license';
import { sendLicenseExpiryAlert } from '../alerts';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in';

export async function runFoodLicenseExpirySweep(now: Date = new Date()): Promise<{
  scanned: number;
  expiring: number;
  expired: number;
  notified: number;
}> {
  // Only branches with an expiry on or before the warning horizon are candidates.
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EXPIRY_WARN_DAYS);
  horizon.setHours(23, 59, 59, 999);

  const due = await (prisma as any).branch.findMany({
    where: {
      isActive: true,
      fssaiExpiresOn: { not: null, lte: horizon }
    },
    select: {
      id: true,
      name: true,
      fssaiLicenseNumber: true,
      fssaiExpiresOn: true,
      restaurant: { select: { id: true, name: true } }
    }
  });

  let expiring = 0;
  let expired = 0;
  let notified = 0;

  for (const b of due) {
    const status = licenseStatus(b.fssaiExpiresOn, Boolean(b.fssaiLicenseNumber), now);
    if (status.state !== 'expiring' && status.state !== 'expired') continue;
    if (status.state === 'expired') expired++;
    else expiring++;

    const res = await sendLicenseExpiryAlert({
      restaurantId: b.restaurant.id,
      restaurantName: b.restaurant.name,
      branchId: b.id,
      branchName: b.name,
      licenseNumber: b.fssaiLicenseNumber ?? null,
      expiresOn: new Date(b.fssaiExpiresOn),
      daysLeft: status.daysLeft ?? 0,
      state: status.state,
      detailUrl: `${SITE}/admin/settings`
    }).catch((e) => {
      log.error({ err: (e as Error).message, branchId: b.id }, 'license expiry alert failed');
      return { sent: false } as { sent: boolean };
    });
    if (res.sent) notified++;
  }

  return { scanned: due.length, expiring, expired, notified };
}
