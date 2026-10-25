/** P2-19 shift overlap; P2-20 push token belongs to one rider. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ clash: null as any, created: [] as any[], ops: [] as any[] }));
vi.mock('@/server/rider-auth', () => ({ auth: async () => ({ user: { id: 'u1', role: 'RIDER' } }) }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: {
      findUnique: async () => ({ id: 'rp1' }),
      updateMany: (args: any) => ({ op: 'detach', args }),
      update: (args: any) => ({ op: 'set', args })
    },
    riderShift: {
      findFirst: async () => m.clash,
      create: async ({ data }: any) => {
        m.created.push(data);
        return { id: 's1', createdAt: new Date(), updatedAt: new Date(), ...data };
      }
    },
    $transaction: async (ops: any[]) => {
      m.ops = ops;
      return ops;
    }
  }
}));

import { POST as bookShift } from '@/app/api/rider/shifts/route';
import { POST as pushToken } from '@/app/api/rider/push-token/route';

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any;
const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);

beforeEach(() => {
  m.clash = null;
  m.created = [];
  m.ops = [];
});

describe('shift booking overlap (P2-19)', () => {
  it('409s on an overlapping shift and books a non-overlapping one', async () => {
    m.clash = { startTime: '10:00', endTime: '14:00' };
    const r = await bookShift(req({ date: tomorrow, startTime: '12:00', endTime: '16:00' }));
    expect(r.status).toBe(409);
    expect(m.created).toHaveLength(0);
    m.clash = null;
    expect((await bookShift(req({ date: tomorrow, startTime: '14:00', endTime: '18:00' }))).status).toBe(201);
  });
});

describe('push token (P2-20)', () => {
  it('detaches the token from other riders before attaching it to the caller', async () => {
    expect((await pushToken(req({ token: 'ExponentPushToken[abc]' }))).status).toBe(200);
    expect(m.ops[0]).toMatchObject({ op: 'detach', args: { where: { expoPushToken: 'ExponentPushToken[abc]', NOT: { userId: 'u1' } } } });
    expect(m.ops[1]).toMatchObject({ op: 'set' });
  });
});
