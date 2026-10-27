/**
 * Location-integrity service: the mock-ping threshold flags a rider, auto-pause
 * only pauses offers when the platform setting is ON (never a silent block),
 * and a FAILED device-integrity verdict flags for review. Prisma + config are
 * mocked — no DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  state: null as any, // RiderIntegrityState row (or null)
  profileUpdate: null as any, // last riderProfile.update data
  spoofCreates: [] as any[],
  createManyCount: 0,
  config: { mockPingThreshold: 3, autoPauseOffers: false, gateOnlineOnFailed: false },
  prev: { currentLat: null as number | null, currentLng: null as number | null },
  lastLocationAt: null as Date | null,
}));

vi.mock('@/server/db', () => ({
  prisma: {
    riderIntegrityState: {
      findUnique: async () => m.state,
      upsert: async ({ create, update }: any) => {
        m.state = m.state ? { ...m.state, ...update } : { riderId: 'r1', status: 'CLEAR', mockPingCount: 0, spoofScore: 0, spoofEventCount: 0, verdict: 'UNEVALUATED', ...create };
        return m.state;
      },
    },
    riderProfile: {
      findUnique: async () => ({ currentLat: m.prev.currentLat, currentLng: m.prev.currentLng, locationSuspect: false, offersPaused: false }),
      update: async ({ data }: any) => {
        m.profileUpdate = data;
        return data;
      },
    },
    riderHeartbeat: { findUnique: async () => ({ lastLocationAt: m.lastLocationAt }) },
    riderSpoofEvent: {
      createMany: async ({ data }: any) => {
        m.createManyCount += data.length;
        return { count: data.length };
      },
      create: async ({ data }: any) => {
        m.spoofCreates.push(data);
        return data;
      },
    },
  },
}));
vi.mock('@/server/rider-integrity/config', () => ({ getIntegrityConfig: async () => m.config }));
vi.mock('@/server/observability/hooks', () => ({ recordSpoofIncident: vi.fn() }));
vi.mock('@/server/rider-integrity/play-integrity', () => ({ isPlayIntegrityConfigured: () => true }));

import { runLocationIntegrity, applyIntegrityVerdict, shouldFlag, SPOOF_FLAG_SCORE } from '@/server/rider-integrity/service';

const mockPoints = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 12.9, lng: 77.6, t: 1_700_000_000_000 + i * 1000, mocked: true as const }));

beforeEach(() => {
  m.state = null;
  m.profileUpdate = null;
  m.spoofCreates = [];
  m.createManyCount = 0;
  m.config = { mockPingThreshold: 3, autoPauseOffers: false, gateOnlineOnFailed: false };
  m.prev = { currentLat: null, currentLng: null };
  m.lastLocationAt = null;
});

describe('shouldFlag', () => {
  it('flags at the mock threshold', () => {
    expect(shouldFlag({ mockPingCount: 3, spoofScore: 0, mockThreshold: 3 })).toBe(true);
    expect(shouldFlag({ mockPingCount: 2, spoofScore: 0, mockThreshold: 3 })).toBe(false);
  });
  it('flags on a high heuristic score', () => {
    expect(shouldFlag({ mockPingCount: 0, spoofScore: SPOOF_FLAG_SCORE, mockThreshold: 3 })).toBe(true);
  });
});

describe('mock-ping threshold → flag', () => {
  it('does NOT flag below the threshold', async () => {
    await runLocationIntegrity({ riderId: 'r1', timedPoints: mockPoints(2) });
    expect(m.state.mockPingCount).toBe(2);
    expect(m.state.status).toBe('CLEAR');
    expect(m.profileUpdate).toBeNull();
  });

  it('flags the rider at the threshold and routes to review', async () => {
    await runLocationIntegrity({ riderId: 'r1', timedPoints: mockPoints(3) });
    expect(m.state.mockPingCount).toBe(3);
    expect(m.state.status).toBe('FLAGGED');
    expect(m.state.flaggedReason).toContain('mock-GPS');
    expect(m.profileUpdate).toMatchObject({ locationSuspect: true });
  });
});

describe('auto-pause only when the setting is on', () => {
  it('does NOT pause offers when the setting is OFF', async () => {
    m.config.autoPauseOffers = false;
    await runLocationIntegrity({ riderId: 'r1', timedPoints: mockPoints(3) });
    expect(m.profileUpdate).toMatchObject({ locationSuspect: true });
    expect(m.profileUpdate.offersPaused).toBeUndefined();
  });

  it('pauses offers when the setting is ON', async () => {
    m.config.autoPauseOffers = true;
    await runLocationIntegrity({ riderId: 'r1', timedPoints: mockPoints(3) });
    expect(m.profileUpdate).toMatchObject({ locationSuspect: true, offersPaused: true });
  });
});

describe('applyIntegrityVerdict', () => {
  it('a FAILED verdict flags the rider and records an incident', async () => {
    const v = await applyIntegrityVerdict('r1', { configured: true, verdict: 'FAILED', detail: 'no_device_verdict' });
    expect(v).toBe('FAILED');
    expect(m.state.status).toBe('FLAGGED');
    expect(m.profileUpdate).toMatchObject({ locationSuspect: true });
    expect(m.spoofCreates.some((e) => e.kind === 'INTEGRITY_FAILED')).toBe(true);
  });

  it('a passing verdict stores the verdict without flagging', async () => {
    const v = await applyIntegrityVerdict('r1', { configured: true, verdict: 'MEETS_DEVICE_INTEGRITY' });
    expect(v).toBe('MEETS_DEVICE_INTEGRITY');
    expect(m.state.verdict).toBe('MEETS_DEVICE_INTEGRITY');
    expect(m.state.status).toBe('CLEAR');
    expect(m.profileUpdate).toBeNull();
  });
});
