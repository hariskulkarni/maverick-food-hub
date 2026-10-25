/** P1-10 — admin assign returns RiderAssignError's status instead of a 500. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/api/admin/orders/_helpers', () => ({ requireOwnedOrderForAdmin: async () => ({ order: { id: 'o1' } }) }));
vi.mock('@/server/rider-allocator', () => {
  class RiderAssignError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  }
  return {
    RiderAssignError,
    assignRider: async (_o: string, riderId: string) => {
      if (riderId === 'busy') throw new RiderAssignError('You already have 2 active deliveries (limit 2).', 409, 'at_capacity');
      return { id: 'a1', riderId };
    }
  };
});

import { POST } from '@/app/api/admin/orders/[id]/assign/route';
const call = (riderId: string) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ riderId }) }) as any, { params: Promise.resolve({ id: 'o1' }) });

describe('admin assign', () => {
  it('maps RiderAssignError to its status and returns the assignment otherwise', async () => {
    const r = await call('busy');
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'at_capacity' });
    expect((await call('rp1')).status).toBe(200);
  });
});
