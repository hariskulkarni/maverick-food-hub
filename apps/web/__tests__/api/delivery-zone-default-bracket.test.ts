/**
 * Defect 9 — a zone created without fee brackets used to refuse every delivery
 * (the fee engine fails closed on []). Creation now seeds one bracket from the
 * branch base fee; an edit can't strip all brackets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: any[] = [];
let existingZone: any;
vi.mock('@/server/tenancy', async () => ({ requireManagedRestaurant: async () => ({ id: 'r1' }), ...(await import('../helpers/tenant-admin-mock')).tenantAdminMocks(() => (async () => ({ id: 'r1' }))()) }));
vi.mock('@/server/db', () => {
  const deliveryZone = {
    create: async ({ data }: any) => { created.push(data); return { id: 'z1', ...data }; },
    updateMany: async () => ({ count: 0 }),
    update: async ({ data }: any) => { created.push(data); return { id: 'z1', ...data }; },
    findUnique: async () => existingZone
  };
  return {
    prisma: {
      branch: {
        findUnique: async ({ where, select }: any) =>
          where.id === 'b1' ? (select?.baseDeliveryFee ? { baseDeliveryFee: '35.00' } : { id: 'b1', restaurantId: 'r1' }) : null
      },
      deliveryZone,
      $transaction: async (fn: any) => fn({ deliveryZone })
    }
  };
});

import { POST } from '@/app/api/admin/delivery-zones/route';
import { PATCH } from '@/app/api/admin/delivery-zones/[id]/route';
import { computeZoneDelivery } from '@/server/delivery/zones';

const req = (body: unknown) => ({ json: async () => body, nextUrl: new URL('http://x/api/admin/delivery-zones') }) as any;
const circle = { branchId: 'b1', name: 'Near', type: 'CIRCLE', centerLat: 12.9, centerLng: 77.6, radiusKm: 3 };

beforeEach(() => {
  created.length = 0;
  existingZone = { id: 'z1', ...circle, feeBrackets: [{ minSubtotal: 0, charge: 3500 }], distanceTiers: [], polygon: null, pincodes: [], branch: { restaurantId: 'r1' } };
});

describe('delivery zone fee brackets', () => {
  it('seeds a ₹0+ bracket at the branch base fee when none are given', async () => {
    const r = await POST(req(circle));
    expect(r.status).toBe(201);
    expect(created[0].feeBrackets).toEqual([{ minSubtotal: 0, charge: 3500 }]);
    // and the engine now accepts a delivery in that zone (it refused with [])
    const d = computeZoneDelivery({ ...created[0], minOrder: null, etaMinutes: null } as any, 25000, 2);
    expect(d).toMatchObject({ available: true, feePaise: 3500 });
    expect(computeZoneDelivery({ ...created[0], feeBrackets: [], minOrder: null, etaMinutes: null } as any, 25000, 2).available).toBe(false);
  });
  it('keeps brackets the admin supplied', async () => {
    await POST(req({ ...circle, feeBrackets: [{ minSubtotal: 0, charge: 0 }] }));
    expect(created[0].feeBrackets).toEqual([{ minSubtotal: 0, charge: 0 }]);
  });
  it('refuses an edit that removes every bracket', async () => {
    const r = await PATCH(req({ feeBrackets: [] }), { params: Promise.resolve({ id: 'z1' }) });
    expect(r.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});
