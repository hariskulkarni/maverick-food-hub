/**
 * H3 — the delivery ETA route must require a session. A null session previously
 * skipped the CUSTOMER ownership check and leaked live ETA to anyone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let order: any;

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/db', () => ({ prisma: { order: { findUnique: async () => order } } }));
vi.mock('@/lib/utils', () => ({ haversineKm: () => 1, clampTwo: (n: number) => n }));

import { GET } from '@/app/api/delivery/eta/[orderId]/route';

const get = () => GET({} as any, { params: Promise.resolve({ orderId: 'o1' }) });

beforeEach(() => {
  session = { user: { id: 'cust1', role: 'CUSTOMER' } };
  order = { id: 'o1', customerId: 'cust1', status: 'OUT_FOR_DELIVERY', address: null, branch: null, assignment: null, placedAt: new Date() };
});

describe('H3: delivery ETA auth', () => {
  it('401 for an unauthenticated caller', async () => {
    session = null;
    expect((await get()).status).toBe(401);
  });
  it('403 for a customer who does not own the order', async () => {
    session = { user: { id: 'other', role: 'CUSTOMER' } };
    expect((await get()).status).toBe(403);
  });
  it('200 for the owning customer', async () => {
    expect((await get()).status).toBe(200);
  });
});
