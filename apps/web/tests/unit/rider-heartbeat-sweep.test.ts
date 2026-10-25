/**
 * The auto-offline sweep must not flip a rider who is mid-delivery (their
 * Home-tab heartbeat pauses while the app is backgrounded in Google Maps).
 */
import { describe, it, expect, vi } from 'vitest';

const flipped: string[][] = [];
const old = new Date(Date.now() - 10 * 60_000);

vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: {
      findMany: async () => [{ id: 'idle' }, { id: 'delivering' }, { id: 'closedOrder' }, { id: 'fresh' }],
      updateMany: async ({ where }: any) => { flipped.push(where.id.in); return { count: where.id.in.length }; }
    },
    riderHeartbeat: {
      findMany: async () => [
        { riderId: 'idle', lastSeenAt: old },
        { riderId: 'delivering', lastSeenAt: old },
        { riderId: 'closedOrder', lastSeenAt: old },
        { riderId: 'fresh', lastSeenAt: new Date() }
      ]
    },
    riderAssignment: {
      findMany: async ({ where }: any) =>
        [
          { riderId: 'delivering', status: 'PICKED_UP', order: { status: 'OUT_FOR_DELIVERY' } },
          { riderId: 'closedOrder', status: 'PICKED_UP', order: { status: 'DELIVERY_FAILED' } }
        ].filter((a) => where.riderId.in.includes(a.riderId))
    }
  }
}));

import { runHeartbeatSweep } from '@/server/rider-heartbeat';

describe('runHeartbeatSweep', () => {
  it('flips stale idle riders but never a rider with an active delivery', async () => {
    const res = await runHeartbeatSweep();
    expect(flipped[0].sort()).toEqual(['closedOrder', 'idle']);
    expect(res.flipped).toBe(2);
  });
});
