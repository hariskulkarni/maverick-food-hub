/**
 * H4 — the order live-location (GPS trail) route must scope EVERY role, not just
 * CUSTOMER. Previously any admin/kitchen/rider at any tenant could read any
 * order's 200-point GPS trail by id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let order: any;
let restaurant: any;

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/tenancy', () => ({ currentRestaurant: async () => restaurant }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: { findUnique: async () => order },
    deliveryLocationPing: { findMany: async () => [] }
  }
}));

import { GET } from '@/app/api/orders/[id]/location/route';

const get = () => GET({} as any, { params: Promise.resolve({ id: 'o1' }) });

beforeEach(() => {
  session = { user: { id: 'cust1', role: 'CUSTOMER' } };
  restaurant = { id: 'A' };
  order = {
    id: 'o1', customerId: 'cust1',
    branch: { restaurantId: 'A' },
    assignment: { rider: { userId: 'rider1' } }
  };
});

describe('H4: order location scope', () => {
  it('401 unauthenticated', async () => { session = null; expect((await get()).status).toBe(401); });
  it('403 customer non-owner', async () => { session = { user: { id: 'x', role: 'CUSTOMER' } }; expect((await get()).status).toBe(403); });
  it('200 owning customer', async () => { expect((await get()).status).toBe(200); });
  it('403 rider not assigned', async () => { session = { user: { id: 'other', role: 'RIDER' } }; expect((await get()).status).toBe(403); });
  it('200 assigned rider', async () => { session = { user: { id: 'rider1', role: 'RIDER' } }; expect((await get()).status).toBe(200); });
  it('403 admin of another tenant', async () => { session = { user: { id: 'a', role: 'ADMIN' } }; restaurant = { id: 'B' }; expect((await get()).status).toBe(403); });
  it('200 admin of the same tenant', async () => { session = { user: { id: 'a', role: 'ADMIN' } }; restaurant = { id: 'A' }; expect((await get()).status).toBe(200); });
  it('200 super-admin any tenant', async () => { session = { user: { id: 's', role: 'SUPER_ADMIN' } }; restaurant = null; expect((await get()).status).toBe(200); });
});
