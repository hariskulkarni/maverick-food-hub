/**
 * Nightly KYC expiry sweep (cron 02:00, see deploy/flavrly-jobs.cron).
 *
 *  1. APPROVED documents whose `expiresOn` is before today (IST) flip to
 *     EXPIRED, with a `kyc.expire` audit row each (mirrors a manual action).
 *  2. P1-14: riders whose KYC gate now blocks them are taken offline and get
 *     an SMS telling them which document to re-upload.
 *  3. Reminder SMS for APPROVED documents expiring in exactly 7 or 1 day(s),
 *     so riders renew before they are blocked. Daily cadence = one SMS per
 *     threshold; the NotificationLog journal (template `rider.kyc.expiring`)
 *     is checked so a re-run the same day doesn't double-send.
 *
 * Never throws per-rider: one bad phone number can't stop the sweep.
 */
import { prisma } from '../db';
import { audit } from '../audit';
import { notify } from '../notifications';
import { brand } from '@/lib/brand';
import { istStartOfDay } from '@/lib/ist';
import { kycTypeLabel, riderKycGate } from '../rider-kyc-gate';
import { log } from '../log';
import { recordStatusEvents } from '../rider-insights/status-events';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_DAYS = [7, 1];

export async function runKycExpirySweep(now: Date = new Date()): Promise<{
  scanned: number;
  flipped: number;
  ridersTakenOffline: number;
  remindersSent: number;
}> {
  const today = istStartOfDay(now);

  // ── 1. Expire ────────────────────────────────────────────────────────────
  const due = await prisma.riderKycDocument.findMany({
    where: { status: 'APPROVED', expiresOn: { not: null, lt: today } },
    select: { id: true, type: true, riderId: true, expiresOn: true }
  });
  let flipped = 0;
  if (due.length > 0) {
    const res = await prisma.riderKycDocument.updateMany({
      where: { id: { in: due.map((d) => d.id) }, status: 'APPROVED' },
      data: { status: 'EXPIRED', reviewedAt: now }
    });
    flipped = res.count;
    for (const d of due) {
      await audit('kyc.expire', {
        actorRole: 'SYSTEM',
        entityType: 'RiderKycDocument',
        entityId: d.id,
        before: { status: 'APPROVED', expiresOn: d.expiresOn },
        after: { status: 'EXPIRED', expiresOn: d.expiresOn }
      });
    }
  }

  // ── 2. Take newly-blocked riders offline + tell them ─────────────────────
  let ridersTakenOffline = 0;
  const affected = [...new Set(due.map((d) => d.riderId))];
  for (const riderId of affected) {
    try {
      const gate = await riderKycGate(riderId, now);
      const rider = await prisma.riderProfile.findUnique({
        where: { id: riderId },
        select: { isOnline: true, user: { select: { id: true, phone: true } } }
      });
      if (!rider) continue;
      if (gate.enforced && !gate.canGoOnline && rider.isOnline) {
        await prisma.riderProfile.update({ where: { id: riderId }, data: { isOnline: false } });
        await recordStatusEvents([{ riderId, type: 'OFFLINE', source: 'kyc_expiry', at: now }]);
        ridersTakenOffline++;
      }
      const expiredTypes = due.filter((d) => d.riderId === riderId).map((d) => kycTypeLabel(d.type));
      if (rider.user.phone) {
        await notify.sms({
          to: rider.user.phone,
          userId: rider.user.id,
          template: 'rider.kyc.expired',
          body: `${brand.name}: your ${expiredTypes.join(', ')} has expired. Upload the renewed document in the rider app (Profile → KYC documents) to keep receiving orders.`
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message, riderId }, 'kyc expiry: rider follow-up failed');
    }
  }

  // ── 3. Reminders before expiry ───────────────────────────────────────────
  let remindersSent = 0;
  for (const days of REMIND_DAYS) {
    const from = new Date(today.getTime() + days * DAY_MS);
    const to = new Date(from.getTime() + DAY_MS);
    const soon = await prisma.riderKycDocument.findMany({
      where: { status: 'APPROVED', expiresOn: { gte: from, lt: to } },
      select: { id: true, type: true, rider: { select: { user: { select: { id: true, phone: true } } } } }
    });
    for (const d of soon) {
      const user = d.rider.user;
      if (!user.phone) continue;
      try {
        const already = await prisma.notificationLog.count({
          where: { userId: user.id, template: 'rider.kyc.expiring', createdAt: { gte: today }, body: { contains: kycTypeLabel(d.type) } }
        });
        if (already > 0) continue;
        await notify.sms({
          to: user.phone,
          userId: user.id,
          template: 'rider.kyc.expiring',
          body: `${brand.name}: your ${kycTypeLabel(d.type)} expires in ${days} day${days === 1 ? '' : 's'}. Upload the renewed document in the rider app to avoid going offline.`
        });
        remindersSent++;
      } catch (e) {
        log.error({ err: (e as Error).message, documentId: d.id }, 'kyc expiry reminder failed');
      }
    }
  }

  return { scanned: due.length, flipped, ridersTakenOffline, remindersSent };
}
