/**
 * Defect 13 sweep — /api/admin/riders must not hijack privileged accounts by
 * phone, and /api/admin/messages must only open threads with this
 * restaurant's riders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let role = 'ADMIN';
const usersByPhone: Record<string, { id: string; role: string }> = {
  '+910000000001': { id: 'admin-of-B', role: 'ADMIN' },
  '+910000000002': { id: 'super', role: 'SUPER_ADMIN' },
  '+910000000003': { id: 'cust', role: 'CUSTOMER' }
};
// riderId -> restaurant ids it is on the roster of
const roster: Record<string, string[]> = { rA: ['A'], rB: ['B'] };
const writes: string[] = [];

vi.mock('@/server/api-auth', () => ({
  requireRestaurantAdminApi: async () =>
    role === 'ADMIN' ? { user: { id: 'u1', role: 'ADMIN', name: 'A admin' } } : new Response('Forbidden', { status: 403 })
}));
vi.mock('@/server/tenancy', () => ({ requireRestaurant: async () => ({ id: 'A', name: 'Resto A' }) }));
vi.mock('@/server/rider-messaging', () => ({
  findOrCreateConversation: async () => ({ id: 'conv1' }),
  postMessage: async () => { writes.push('message'); },
  serializeConversation: (c: unknown) => c
}));
vi.mock('@/server/db', () => ({
  prisma: {
    branch: { findFirst: async ({ where }: any) => (where.id === 'bA' && where.restaurantId === 'A' ? { id: 'bA' } : null) },
    user: {
      findUnique: async ({ where }: any) => usersByPhone[where.phone] ?? null,
      update: async ({ where, data }: any) => { writes.push(`role:${where.id}:${data.role}`); return { id: where.id }; },
      create: async ({ data }: any) => { writes.push(`create:${data.phone}`); return { id: 'newuser' }; }
    },
    riderProfile: {
      upsert: async () => ({ id: 'rp1' }),
      findFirst: async ({ where }: any) => {
        const rest = where.OR[0].dedicatedRestaurantId;
        return (roster[where.id] ?? []).includes(rest) ? { id: where.id } : null;
      }
    },
    riderConversation: { findUnique: async () => ({ id: 'conv1', messages: [], rider: { user: {} }, _count: { messages: 1 } }) }
  }
}));

import { POST as addRider } from '@/app/api/admin/riders/route';
import { POST as sendMessage } from '@/app/api/admin/messages/route';

const req = (body: unknown) => ({ json: async () => body }) as any;
const rider = (phone: string) => ({ name: 'Ravi', phone, branchId: 'bA' });

beforeEach(() => { writes.length = 0; role = 'ADMIN'; });

describe('/api/admin/riders', () => {
  it('refuses to turn another restaurant admin or a super admin into a rider', async () => {
    expect((await addRider(req(rider('+910000000001')))).status).toBe(409);
    expect((await addRider(req(rider('+910000000002')))).status).toBe(409);
    expect(writes).toEqual([]);
  });
  it('promotes a customer and creates a new phone', async () => {
    expect((await addRider(req(rider('+910000000003')))).status).toBe(200);
    expect((await addRider(req(rider('+910000000009')))).status).toBe(200);
    expect(writes).toEqual(['role:cust:RIDER', 'create:+910000000009']);
  });
  it('is ADMIN-only', async () => {
    role = 'KITCHEN';
    expect((await addRider(req(rider('+910000000009')))).status).toBe(403);
  });
});

describe('/api/admin/messages POST', () => {
  it('refuses a rider not on this restaurant roster', async () => {
    const r = await sendMessage(req({ riderId: 'rB', body: 'hi' }));
    expect(r.status).toBe(404);
    expect(writes).toEqual([]);
  });
  it('allows a roster rider', async () => {
    const r = await sendMessage(req({ riderId: 'rA', body: 'hi' }));
    expect(r.status).toBe(201);
    expect(writes).toEqual(['message']);
  });
});
