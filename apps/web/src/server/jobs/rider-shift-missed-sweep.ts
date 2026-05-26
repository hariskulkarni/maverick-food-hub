/**
 * Rider shift "missed" sweep.
 *
 * A RiderShift is BOOKED in advance. If a rider never starts it (status stays
 * BOOKED past the shift's start time plus a short grace window), the slot is
 * flipped to MISSED so ops can see no-shows and the rider's reliability stats
 * stay honest.
 *
 * RiderShift stores `date` (a calendar date) + `startTime` as "HH:MM" in local
 * IST. We reconstruct the absolute start instant in IST (UTC+5:30) and compare
 * it against now minus the grace period. Each flip emits a `rider.shift.missed`
 * audit row so the trail mirrors a manual action.
 *
 * Triggered from /api/platform/jobs/rider-shift-missed/run on a periodic cron
 * (e.g. every 15-30 min) or on demand from the super-admin dashboard.
 */
import { prisma } from '../db';
import { audit } from '../audit';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
const GRACE_MINUTES = 30; // riders get 30 min after start before it's a no-show

/**
 * Absolute start instant (UTC ms) for a shift whose `date` is stored at UTC
 * midnight and whose `startTime` is "HH:MM" in IST local time.
 */
export function shiftStartMs(date: Date, startTime: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  // `date` is a @db.Date — Prisma returns it at UTC midnight of that calendar
  // day. The local IST wall-clock start is that midnight + HH:MM, expressed in
  // IST, so the UTC instant is (utcMidnight + HH:MM) - IST offset.
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcMidnight + (hh * 60 + mm) * 60 * 1000 - IST_OFFSET_MS;
}

export async function runRiderShiftMissedSweep(): Promise<{ scanned: number; flipped: number }> {
  const now = Date.now();

  // Pull BOOKED shifts dated today or earlier (UTC date window is generous;
  // we filter precisely on the reconstructed start instant below). Anything
  // dated strictly in the future can't be missed yet.
  const tomorrowUtc = new Date(now + IST_OFFSET_MS);
  tomorrowUtc.setUTCHours(0, 0, 0, 0);
  tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);

  const candidates = await prisma.riderShift.findMany({
    where: { status: 'BOOKED', date: { lt: tomorrowUtc } },
    select: { id: true, riderId: true, date: true, startTime: true, zoneName: true }
  });

  const dueIds: string[] = [];
  const dueRows: typeof candidates = [];
  for (const s of candidates) {
    const startMs = shiftStartMs(s.date, s.startTime);
    if (startMs === null) continue;
    if (now >= startMs + GRACE_MINUTES * 60 * 1000) {
      dueIds.push(s.id);
      dueRows.push(s);
    }
  }

  if (dueIds.length === 0) return { scanned: candidates.length, flipped: 0 };

  // Guard the update on status BOOKED so we don't clobber a shift a rider
  // started in the brief window between read and write.
  const res = await prisma.riderShift.updateMany({
    where: { id: { in: dueIds }, status: 'BOOKED' },
    data: { status: 'MISSED' }
  });

  for (const s of dueRows) {
    await audit('rider.shift.missed', {
      actorRole: 'SYSTEM',
      entityType: 'RiderShift',
      entityId: s.id,
      before: { status: 'BOOKED' },
      after: { status: 'MISSED', riderId: s.riderId, startTime: s.startTime, zoneName: s.zoneName }
    });
  }

  return { scanned: candidates.length, flipped: res.count };
}
