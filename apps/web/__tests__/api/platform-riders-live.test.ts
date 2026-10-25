/**
 * GET /api/platform/riders/live — the 4 s poll behind /platform/live must
 * return the same freshness and workflow state as the first paint: real fix
 * time, "signal lost", leg/status, active-order count — and no rider phone
 * numbers (the map never shows them).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  profiles: [] as any[],
  heartbeats: [] as any[],
  lastWhere: null as any,
}));

vi.mock('@/server/api-auth', () => ({
  requireCapabilityApi: h.gate,
  requireSuperAdminApi: h.gate,
}));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findMany: async (args: any) => { h.lastWhere = args.where; return h.profiles; } },
    riderHeartbeat: { findMany: async () => h.heartbeats },
  },
}));

import { GET } from '@/app/api/platform/riders/live/route';

beforeEach(() => {
  h.gate.mockReset();
  h.gate.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
  h.profiles = [];
  h.heartbeats = [];
});

const branch = { latitude: 16.3, longitude: 80.43 };
const address = { latitude: 16.32, longitude: 80.45 };

describe('GET /api/platform/riders/live', () => {
  it('is gated by the same ops:read capability as the /platform/live page', async () => {
    h.gate.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(h.gate).toHaveBeenCalledWith('ops:read');
  });

  it('returns real fix time, signal-lost flag, status and leg; no phone numbers', async () => {
    h.profiles = [
      {
        id: 'fresh', isOnline: true, currentLat: 16.31, currentLng: 80.44, updatedAt: ago(3_600_000),
        user: { name: 'Ravi', phone: '+919999999999' },
        assignments: [{ status: 'PICKED_UP', assignedAt: ago(600_000), order: { id: 'o1', status: 'OUT_FOR_DELIVERY', customer: { name: 'C' }, branch, address } }],
      },
      {
        id: 'ghost', isOnline: true, currentLat: 16.2, currentLng: 80.2, updatedAt: ago(3_600_000),
        user: { name: 'Old', phone: '+918888888888' }, assignments: [],
      },
    ];
    h.heartbeats = [
      { riderId: 'fresh', lastSeenAt: ago(5_000), lastLocationAt: ago(8_000) },
      { riderId: 'ghost', lastSeenAt: ago(45 * 60_000), lastLocationAt: ago(45 * 60_000) },
    ];
    const body = await (await GET()).json();
    const fresh = body.riders.find((r: any) => r.riderId === 'fresh');
    const ghost = body.riders.find((r: any) => r.riderId === 'ghost');

    expect(fresh.at).toBe(ago(8_000).toISOString());
    expect(fresh.stale).toBe(false);
    expect(fresh.status).toBe('PICKED_UP');
    expect(fresh.orderId).toBe('o1');
    expect(fresh.dest).toEqual({ lat: 16.32, lng: 80.45 });
    expect(ghost.stale).toBe(true);
    expect(ghost.status).toBe('IDLE');
    expect(JSON.stringify(body)).not.toContain('+91');
    expect(body.customers).toEqual([{ id: 'o1', name: 'C', lat: 16.32, lng: 80.45 }]);
  });

  it('includes a rider mid-delivery even if their online flag dropped', async () => {
    await GET();
    expect(h.lastWhere).toEqual({
      OR: [{ isOnline: true }, { assignments: { some: { status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } } } }],
    });
  });

  it('drops an offline rider whose only assignment belongs to a closed order', async () => {
    h.profiles = [{
      id: 'done', isOnline: false, currentLat: 1, currentLng: 2, updatedAt: ago(1000), user: { name: 'D' },
      assignments: [{ status: 'PICKED_UP', assignedAt: ago(1000), order: { id: 'o9', status: 'DELIVERED', branch, address } }],
    }];
    const body = await (await GET()).json();
    expect(body.riders).toEqual([]);
  });
});
