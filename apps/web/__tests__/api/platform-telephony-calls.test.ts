/**
 * GET /api/platform/telephony/calls — super-admin only, needs orderId|riderId,
 * DTO carries ids/outcomes/timings and no phone numbers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let gate: any;
let lastWhere: any;

vi.mock('@/server/api-auth', () => ({ requireSuperAdminApi: async () => gate }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/db', () => ({
  prisma: {
    callLog: {
      findMany: async ({ where }: any) => {
        lastWhere = where;
        return [
          {
            id: 'cl1',
            provider: 'exotel',
            direction: 'RIDER_TO_CUSTOMER',
            status: 'COMPLETED',
            durationSec: 42,
            startedAt: new Date('2026-10-27T05:00:00Z'),
            endedAt: new Date('2026-10-27T05:00:42Z'),
            createdAt: new Date('2026-10-27T04:59:50Z'),
            riderLegStatus: 'completed',
            customerLegStatus: 'completed',
            failureReason: null,
            order: { id: 'o1', code: 'ORD-1' },
            rider: { id: 'rp1', user: { name: 'Ravi', phone: '+919811122233' } },
          },
        ];
      },
    },
  },
}));

import { GET } from '@/app/api/platform/telephony/calls/route';

const get = (qs: string) => GET(new NextRequest(`https://x.in/api/platform/telephony/calls?${qs}`));

beforeEach(() => {
  gate = { user: { id: 'sa', role: 'SUPER_ADMIN' } };
  lastWhere = null;
});

describe('platform call logs', () => {
  it('is gated to super-admins', async () => {
    gate = new Response('Forbidden', { status: 403 });
    expect((await get('orderId=cmorder123456')).status).toBe(403);
  });

  it('requires a valid orderId or riderId', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('orderId=bad id')).status).toBe(400);
  });

  it('returns number-free rows filtered by order or rider', async () => {
    const r = await get('orderId=cmorder123456');
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toMatch(/9811122233/);
    expect(lastWhere).toEqual({ orderId: 'cmorder123456' });
    expect(JSON.parse(text).calls[0]).toMatchObject({ id: 'cl1', status: 'COMPLETED', durationSec: 42, order: { code: 'ORD-1' }, rider: { id: 'rp1', name: 'Ravi' } });
    await get('riderId=cmrider1234567');
    expect(lastWhere).toEqual({ riderId: 'cmrider1234567' });
  });
});
