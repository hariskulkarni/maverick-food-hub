/**
 * Nightly KYC expiry sweep.
 *
 * Any RiderKycDocument that is currently APPROVED but whose `expiresOn` has
 * passed (strictly before today 00:00) flips to EXPIRED. Each flip emits a
 * `kyc.expire` audit entry so the trail mirrors a manual super-admin action.
 *
 * Triggered from /api/platform/jobs/kyc-expiry/run on a daily cron (or on
 * demand from the super-admin dashboard).
 */
import { prisma } from '../db';
import { audit } from '../audit';

export async function runKycExpirySweep(): Promise<{ scanned: number; flipped: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find APPROVED docs whose expiry is in the past.
  const due = await prisma.riderKycDocument.findMany({
    where: {
      status: 'APPROVED',
      expiresOn: { not: null, lt: today }
    },
    select: { id: true, type: true, riderId: true, expiresOn: true }
  });

  if (due.length === 0) return { scanned: 0, flipped: 0 };

  const ids = due.map((d) => d.id);
  const res = await prisma.riderKycDocument.updateMany({
    where: { id: { in: ids }, status: 'APPROVED' },
    data: { status: 'EXPIRED', reviewedAt: new Date() }
  });

  // Audit one row per doc — failures are swallowed inside audit() so the
  // sweep never blocks on logging.
  for (const d of due) {
    await audit('kyc.expire', {
      actorRole: 'SYSTEM',
      entityType: 'RiderKycDocument',
      entityId: d.id,
      before: { status: 'APPROVED', expiresOn: d.expiresOn },
      after:  { status: 'EXPIRED', expiresOn: d.expiresOn }
    });
  }

  return { scanned: due.length, flipped: res.count };
}
