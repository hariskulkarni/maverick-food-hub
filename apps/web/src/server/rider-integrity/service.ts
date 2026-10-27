/**
 * Rider location-integrity service (anti-fraud). Ties the pure heuristics and
 * the mocked-GPS flag to per-rider state, the ops review queue and the
 * observability counters. Fraud prevention on OPERATIONAL location only — never
 * anything about the rider's personal phone use.
 *
 * Pipeline per location ping (runLocationIntegrity):
 *   mocked pings      → dropped from live position by the route, counted here;
 *   movement signals  → evaluateSpoof() over the newly accepted fixes;
 *   both              → RiderSpoofEvent rows + shift counters + obs counters;
 *   threshold reached → flag the rider (locationSuspect) into the review queue,
 *                       and ONLY if the auto-pause setting is on, pause offers.
 *
 * Everything here is best-effort and never throws: a fraud check must never
 * fail a rider's location ping or shift toggle.
 */
import type { RiderIntegrityVerdict } from '@prisma/client';
import { prisma } from '../db';
import { recordSpoofIncident } from '../observability/hooks';
import { getIntegrityConfig } from './config';
import { evaluateSpoof, MOCK_SCORE, type SpoofPoint, type SpoofSignal } from './heuristics';
import { isPlayIntegrityConfigured, type IntegrityResult } from './play-integrity';

/** Shift suspicion score (heuristics, not mock pings) that also flags for review. */
export const SPOOF_FLAG_SCORE = 60;

type TimedPoint = SpoofPoint & { mocked?: boolean };

/** Reset the current-shift counters when a rider goes online. Keeps verdict + review history. */
export async function resetShiftCounters(riderId: string, now: Date = new Date()): Promise<void> {
  try {
    await prisma.riderIntegrityState.upsert({
      where: { riderId },
      create: { riderId, shiftStartedAt: now },
      update: { shiftStartedAt: now, mockPingCount: 0, spoofEventCount: 0, spoofScore: 0 },
    });
  } catch {
    // best-effort
  }
}

/** Decide whether the shift's tallies warrant flagging for ops review. */
export function shouldFlag(input: { mockPingCount: number; spoofScore: number; mockThreshold: number }): boolean {
  return input.mockPingCount >= input.mockThreshold || input.spoofScore >= SPOOF_FLAG_SCORE;
}

/**
 * Process one location ping's integrity signals. `timedPoints` are the accepted
 * fixes with clock-corrected `t` (mocked ones included, marked `mocked`).
 */
export async function runLocationIntegrity(input: {
  riderId: string;
  orderId?: string | null;
  timedPoints: TimedPoint[];
  driftMs?: number;
  now?: Date;
}): Promise<void> {
  try {
    const { riderId } = input;
    const now = input.now ?? new Date();
    const orderId = input.orderId ?? null;
    const mocked = input.timedPoints.filter((p) => p.mocked);
    const clean = input.timedPoints.filter((p) => !p.mocked);

    // Previous trusted position (before this ping) for teleport / speed.
    const [state, profile, heartbeat, config] = await Promise.all([
      prisma.riderIntegrityState.findUnique({ where: { riderId } }),
      prisma.riderProfile.findUnique({ where: { id: riderId }, select: { currentLat: true, currentLng: true } }),
      prisma.riderHeartbeat.findUnique({ where: { riderId }, select: { lastLocationAt: true } }),
      getIntegrityConfig(),
    ]);

    const prev: SpoofPoint | null =
      profile?.currentLat != null && profile?.currentLng != null && heartbeat?.lastLocationAt
        ? { lat: profile.currentLat, lng: profile.currentLng, t: heartbeat.lastLocationAt.getTime() }
        : null;

    const signals: SpoofSignal[] = evaluateSpoof({ prev, points: clean, driftMs: input.driftMs });

    // Build the evidence rows: one per mocked ping (capped) + one per signal.
    const mockSample = mocked[0];
    const events: { kind: string; score: number; reason: string; lat?: number; lng?: number; at: Date }[] = [];
    if (mocked.length > 0) {
      events.push({
        kind: 'MOCK_FLAG',
        score: MOCK_SCORE,
        reason:
          mocked.length === 1
            ? 'Ping reported by the OS as a mock (fake GPS) location'
            : `${mocked.length} pings reported by the OS as mock (fake GPS) locations`,
        lat: mockSample?.lat,
        lng: mockSample?.lng,
        at: now,
      });
    }
    for (const s of signals) {
      events.push({ kind: s.kind, score: s.score, reason: s.reason, lat: s.lat, lng: s.lng, at: s.at ? new Date(s.at) : now });
    }
    if (events.length === 0) return;

    await prisma.riderSpoofEvent.createMany({
      data: events.map((e) => ({
        riderId,
        orderId,
        kind: e.kind,
        score: e.score,
        reason: e.reason,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
        at: e.at,
      })),
    });
    for (const e of events) recordSpoofIncident(e.kind);

    // spoofScore tracks the HEURISTIC suspicion only. Mocked pings are governed
    // by their own configurable per-shift count threshold, so they never also
    // trip the score-based flag (that would bypass the configured threshold).
    const signalScore = signals.reduce((n, s) => n + s.score, 0);
    const mockPingCount = (state?.mockPingCount ?? 0) + mocked.length;
    const spoofEventCount = (state?.spoofEventCount ?? 0) + events.length;
    const spoofScore = (state?.spoofScore ?? 0) + signalScore;

    const flag = shouldFlag({ mockPingCount, spoofScore, mockThreshold: config.mockPingThreshold });
    const alreadyFlagged = state?.status === 'FLAGGED';
    const reason =
      mockPingCount >= config.mockPingThreshold
        ? `${mockPingCount} mock-GPS pings this shift (threshold ${config.mockPingThreshold})`
        : `Spoofing suspicion score ${spoofScore} this shift`;

    await prisma.riderIntegrityState.upsert({
      where: { riderId },
      create: {
        riderId,
        mockPingCount,
        spoofEventCount,
        spoofScore,
        lastSpoofAt: now,
        ...(flag ? { status: 'FLAGGED', flaggedAt: now, flaggedReason: reason } : {}),
      },
      update: {
        mockPingCount,
        spoofEventCount,
        spoofScore,
        lastSpoofAt: now,
        // Re-open on a fresh flag; leave an already-flagged rider's review metadata alone.
        ...(flag && !alreadyFlagged
          ? { status: 'FLAGGED', flaggedAt: now, flaggedReason: reason, reviewedById: null, reviewedAt: null, reviewNote: null }
          : {}),
      },
    });

    if (flag) {
      await prisma.riderProfile.update({
        where: { id: riderId },
        data: {
          locationSuspect: true,
          // Pause offers ONLY when the platform setting is on — never a silent hard-block.
          ...(config.autoPauseOffers ? { offersPaused: true } : {}),
        },
      });
    }
  } catch {
    // best-effort — never fail the ping
  }
}

/**
 * Store the latest Play Integrity verdict for a rider. A FAILED verdict records
 * an INTEGRITY_FAILED spoof event and flags the rider for review. Returns the
 * stored verdict so the caller can gate going online when the setting is on.
 */
export async function applyIntegrityVerdict(
  riderId: string,
  result: IntegrityResult,
  now: Date = new Date(),
): Promise<RiderIntegrityVerdict> {
  const verdict = result.verdict as RiderIntegrityVerdict;
  try {
    const failed = result.verdict === 'FAILED';
    await prisma.riderIntegrityState.upsert({
      where: { riderId },
      create: {
        riderId,
        verdict,
        verdictDetail: result.detail ?? null,
        verdictCheckedAt: now,
        ...(failed ? { status: 'FLAGGED', flaggedAt: now, flaggedReason: 'Failed device integrity attestation' } : {}),
      },
      update: {
        verdict,
        verdictDetail: result.detail ?? null,
        verdictCheckedAt: now,
        ...(failed ? { status: 'FLAGGED', flaggedAt: now, flaggedReason: 'Failed device integrity attestation' } : {}),
      },
    });
    if (failed) {
      recordSpoofIncident('INTEGRITY_FAILED');
      await prisma.riderSpoofEvent.create({
        data: { riderId, kind: 'INTEGRITY_FAILED', score: 60, reason: `Play Integrity verdict FAILED (${result.detail ?? 'no device verdict'})`, at: now },
      });
      await prisma.riderProfile.update({ where: { id: riderId }, data: { locationSuspect: true } });
    }
  } catch {
    // best-effort
  }
  return verdict;
}

export type ReviewAction = 'clear' | 'keep' | 'pause' | 'resume';

/** Ops review-queue action. Returns false when the rider has no integrity row. */
export async function reviewRider(
  riderId: string,
  action: ReviewAction,
  operatorId: string | null,
  note: string | null,
  now: Date = new Date(),
): Promise<{ status: string; locationSuspect: boolean; offersPaused: boolean } | null> {
  try {
    const state = await prisma.riderIntegrityState.findUnique({ where: { riderId } });
    if (!state) return null;

    const stateData: Record<string, unknown> = { reviewedById: operatorId, reviewedAt: now, reviewNote: note };
    const profileData: Record<string, unknown> = {};

    switch (action) {
      case 'clear':
        stateData.status = 'CLEARED';
        stateData.mockPingCount = 0;
        stateData.spoofScore = 0;
        profileData.locationSuspect = false;
        profileData.offersPaused = false;
        break;
      case 'keep':
        stateData.status = 'FLAGGED';
        profileData.locationSuspect = true;
        break;
      case 'pause':
        stateData.status = 'FLAGGED';
        profileData.locationSuspect = true;
        profileData.offersPaused = true;
        break;
      case 'resume':
        profileData.offersPaused = false;
        break;
    }

    await prisma.$transaction([
      prisma.riderIntegrityState.update({ where: { riderId }, data: stateData }),
      prisma.riderProfile.update({ where: { id: riderId }, data: profileData }),
    ]);

    const p = await prisma.riderProfile.findUnique({
      where: { id: riderId },
      select: { locationSuspect: true, offersPaused: true, integrityState: { select: { status: true } } },
    });
    return {
      status: p?.integrityState?.status ?? 'CLEAR',
      locationSuspect: p?.locationSuspect ?? false,
      offersPaused: p?.offersPaused ?? false,
    };
  } catch {
    return null;
  }
}

/** Integrity detail for one rider — powers the insights "Location integrity" section. */
export async function getRiderIntegrity(riderId: string) {
  const [profile, state, events] = await Promise.all([
    prisma.riderProfile.findUnique({ where: { id: riderId }, select: { locationSuspect: true, offersPaused: true } }),
    prisma.riderIntegrityState.findUnique({ where: { riderId } }),
    prisma.riderSpoofEvent.findMany({ where: { riderId }, orderBy: { at: 'desc' }, take: 20 }),
  ]);
  if (!profile) return null;
  return {
    status: state?.status ?? 'CLEAR',
    locationSuspect: profile.locationSuspect,
    offersPaused: profile.offersPaused,
    shift: {
      startedAt: state?.shiftStartedAt?.toISOString() ?? null,
      mockPingCount: state?.mockPingCount ?? 0,
      spoofEventCount: state?.spoofEventCount ?? 0,
      spoofScore: state?.spoofScore ?? 0,
      lastSpoofAt: state?.lastSpoofAt?.toISOString() ?? null,
    },
    integrity: {
      configured: isPlayIntegrityConfigured(),
      verdict: state?.verdict ?? 'UNEVALUATED',
      detail: state?.verdictDetail ?? null,
      checkedAt: state?.verdictCheckedAt?.toISOString() ?? null,
    },
    flagged: state?.flaggedAt ? { at: state.flaggedAt.toISOString(), reason: state.flaggedReason } : null,
    review:
      state?.reviewedAt && state.reviewedById
        ? { at: state.reviewedAt.toISOString(), by: state.reviewedById, note: state.reviewNote }
        : null,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      score: e.score,
      reason: e.reason,
      orderId: e.orderId,
      lat: e.lat,
      lng: e.lng,
      at: e.at.toISOString(),
    })),
  };
}

export type RiderIntegrityDTO = NonNullable<Awaited<ReturnType<typeof getRiderIntegrity>>>;

/** The platform review queue: riders currently flagged suspect, worst first. */
export async function listIntegrityQueue(opts: { includeCleared?: boolean } = {}) {
  const riders = await prisma.riderProfile.findMany({
    where: opts.includeCleared
      ? { OR: [{ locationSuspect: true }, { integrityState: { status: 'CLEARED' } }] }
      : { locationSuspect: true },
    select: {
      id: true,
      locationSuspect: true,
      offersPaused: true,
      isOnline: true,
      user: { select: { name: true, phone: true } },
      integrityState: true,
      spoofEvents: { orderBy: { at: 'desc' }, take: 5, select: { kind: true, at: true } },
    },
    take: 200,
  });
  const rows = riders.map((r) => ({
    riderId: r.id,
    name: r.user.name,
    phone: r.user.phone,
    isOnline: r.isOnline,
    locationSuspect: r.locationSuspect,
    offersPaused: r.offersPaused,
    status: r.integrityState?.status ?? 'CLEAR',
    mockPingCount: r.integrityState?.mockPingCount ?? 0,
    spoofScore: r.integrityState?.spoofScore ?? 0,
    verdict: r.integrityState?.verdict ?? 'UNEVALUATED',
    flaggedAt: r.integrityState?.flaggedAt?.toISOString() ?? null,
    flaggedReason: r.integrityState?.flaggedReason ?? null,
    lastSpoofAt: r.integrityState?.lastSpoofAt?.toISOString() ?? null,
    reviewedAt: r.integrityState?.reviewedAt?.toISOString() ?? null,
    recentKinds: r.spoofEvents.map((e) => e.kind),
  }));
  // Worst first: higher score, then most recent incident.
  rows.sort((a, b) => b.spoofScore - a.spoofScore || (b.lastSpoofAt ?? '').localeCompare(a.lastSpoofAt ?? ''));
  return rows;
}
