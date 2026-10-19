/**
 * H16 — tip route: rate-limited, valid-state only, set-once (one tip per order),
 * ownership enforced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any; let order: any; let rl: any; let applied = 1;

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => rl }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: { findUnique: async () => order },
    $transaction: async (fn: any) => fn({
      riderAssignment: { updateMany: async () => ({ count: applied }), findUnique: async () => ({ id: 'a1', tipAmt: 50 }) },
      riderProfile: { update: async () => ({}) }
    })
  }
}));

import { POST } from '@/app/api/orders/[id]/tip/route';
const post = () => POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 50 }) }) as any, { params: Promise.resolve({ id: 'o1' }) });

beforeEach(() => {
  session = { user: { id: 'c1' } };
  rl = { ok: true };
  applied = 1;
  order = { id: 'o1', customerId: 'c1', status: 'DELIVERED', assignment: { id: 'a1', riderId: 'r1', tipAmt: 0, baseEarningsAmt: 100, bonusAmt: 0 } };
});

describe('H16: tip route', () => {
  it('401 unauthenticated', async () => { session = null; expect((await post()).status).toBe(401); });
  it('429 when rate-limited', async () => { rl = { ok: false, response: new Response('rl', { status: 429 }) }; expect((await post()).status).toBe(429); });
  it('404 non-owner', async () => { order.customerId = 'other'; expect((await post()).status).toBe(404); });
  it('409 when order not in a tippable state', async () => { order.status = 'RECEIVED'; expect((await post()).status).toBe(409); });
  it('409 when already tipped', async () => { order.assignment.tipAmt = 25; expect((await post()).status).toBe(409); });
  it('200 on the first tip', async () => { expect((await post()).status).toBe(200); });
  it('409 when the set-once write loses the race (count 0)', async () => { applied = 0; expect((await post()).status).toBe(409); });
});
