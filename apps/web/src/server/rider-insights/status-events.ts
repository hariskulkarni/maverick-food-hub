/**
 * Rider online/offline/signal history (RiderStatusEvent).
 *
 *   ONLINE / OFFLINE   — the rider's own toggle (source "rider"), sign-out
 *                        ("logout") or the KYC-expiry sweep ("kyc_expiry")
 *   AUTO_OFFLINE       — the heartbeat sweep flipped a silent rider offline
 *   SIGNAL_LOST        — the sweep found a rider silent but mid-delivery (kept
 *                        online so the order isn't orphaned)
 *   SIGNAL_REGAINED    — the next heartbeat / location post after SIGNAL_LOST
 *
 * Recording is best-effort and never throws: an insights write must never
 * fail a rider's toggle, heartbeat or location ping.
 */
import type { RiderStatusEventType } from '@prisma/client';
import { prisma } from '../db';

export interface StatusEventInput {
  riderId: string;
  type: RiderStatusEventType;
  source?: string;
  at?: Date;
}

export async function recordStatusEvents(events: StatusEventInput[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await prisma.riderStatusEvent.createMany({
      data: events.map((e) => ({ riderId: e.riderId, type: e.type, source: e.source ?? null, at: e.at ?? new Date() })),
    });
  } catch {
    // best-effort
  }
}

/** Heartbeat sweep: mark silent mid-delivery riders as signal-lost (one SIGNAL_LOST each). */
export async function markSignalLost(riderIds: string[], now: Date = new Date()): Promise<void> {
  if (riderIds.length === 0) return;
  try {
    await prisma.riderHeartbeat.updateMany({ where: { riderId: { in: riderIds }, signalLostAt: null }, data: { signalLostAt: now } });
    await recordStatusEvents(riderIds.map((riderId) => ({ riderId, type: 'SIGNAL_LOST', source: 'heartbeat_sweep', at: now })));
  } catch {
    // best-effort
  }
}

/** Clear the signal-lost mark without an event (e.g. the rider was auto-offlined). */
export async function clearSignalLost(riderIds: string[]): Promise<void> {
  if (riderIds.length === 0) return;
  try {
    await prisma.riderHeartbeat.updateMany({ where: { riderId: { in: riderIds } }, data: { signalLostAt: null } });
  } catch {
    // best-effort
  }
}

/**
 * Called on every heartbeat / location post: if the sweep had marked this
 * rider's signal lost, clear the mark and record SIGNAL_REGAINED (once).
 */
export async function markSignalRegained(riderId: string, source: 'heartbeat' | 'location'): Promise<boolean> {
  try {
    const res = await prisma.riderHeartbeat.updateMany({
      where: { riderId, signalLostAt: { not: null } },
      data: { signalLostAt: null },
    });
    if (res.count === 0) return false;
    await recordStatusEvents([{ riderId, type: 'SIGNAL_REGAINED', source }]);
    return true;
  } catch {
    return false;
  }
}

/** The rider profile id of `userId` when it is online right now (else null). Never throws. */
export async function onlineRiderIdForUser(userId: string): Promise<string | null> {
  try {
    const p = await prisma.riderProfile.findFirst({ where: { userId, isOnline: true }, select: { id: true } });
    return p?.id ?? null;
  } catch {
    return null;
  }
}
