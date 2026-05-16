/**
 * BatchInvitation auto-expiry sweeper.
 *
 * Each invitation carries a 15-second TTL (`expiresAt`). The rider's modal
 * counts down client-side and silently fires DECLINE at zero, but the server
 * is the source of truth: any PENDING row whose `expiresAt` is in the past
 * must be flipped to EXPIRED so a stale push never wins a race.
 *
 * `expireStaleBatchInvitations()` is idempotent and cheap — it's a single
 * `updateMany` indexed on (status, expiresAt). Safe to run on a 5-second
 * interval; safe to call manually from a route for testing.
 *
 * See `realtime.ts` for the global ticker that schedules this — we host the
 * interval there because the realtime module is already a module-level
 * singleton with a guaranteed once-per-process lifecycle in this codebase.
 */
import { BatchInvitationStatus } from '@prisma/client';
import { prisma } from './db';
import { log } from './log';

export async function expireStaleBatchInvitations(): Promise<number> {
  const now = new Date();
  try {
    const result = await prisma.batchInvitation.updateMany({
      where: {
        status: BatchInvitationStatus.PENDING,
        expiresAt: { lt: now },
      },
      data: {
        status: BatchInvitationStatus.EXPIRED,
        respondedAt: now,
      },
    });
    return result.count;
  } catch (err) {
    log.error({ err }, 'expireStaleBatchInvitations failed');
    return 0;
  }
}
