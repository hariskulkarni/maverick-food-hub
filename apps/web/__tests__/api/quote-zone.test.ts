import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  terms: vi.fn(),
  prisma: {
    branch: { findUniqueOrThrow: vi.fn() },
    address: { findUnique: vi.fn() },
    combo: { findUnique: vi.fn() }
  }
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/offers', () => ({ loadAndApplyOffers: vi.fn(), loadOfferByCode: vi.fn() }));
vi.mock('@/server/delivery/placement', () => ({ resolveDeliveryTerms: h.terms }));

import { POST } from '@/app/api/checkout/quote/route';

const call = (b: Record<string, unknown>) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(b) }) as never);
const body = { branchId: 'b1', addressId: 'a1', items: [{ comboId: 'c1', quantity: 1 }] };

beforeEach(() => {
  vi.resetAllMocks();
  h.prisma.branch.findUniqueOrThrow.mockResolvedValue({
    id: 'b1', taxRatePct: 0, baseDeliveryFee: 30, perKmDeliveryFee: 10, packagingFee: 0, latitude: 12.9, longitude: 77.6
  });
  h.prisma.address.findUnique.mockResolvedValue({ id: 'a1', latitude: 12.9, longitude: 77.6, postalCode: '560001' });
  h.prisma.combo.findUnique.mockResolvedValue({ id: 'c1', price: 300 });
});

describe('quote mirrors placement delivery terms', () => {
  it('uses the zone fee and returns eta/min', async () => {
    h.terms.mockResolvedValue({ kind: 'zone', feeRupees: 49, minOrderPaise: 10000, etaMinutes: 30, distanceKm: 3 });
    const j = await (await call(body)).json();
    expect(j.deliveryFee).toBe(49);
    expect(j.zone).toEqual({ etaMinutes: 30, minOrderPaise: 10000 });
    expect(j.zoneBlock).toBeNull();
  });
  it('surfaces a block reason when rejected', async () => {
    h.terms.mockResolvedValue({ kind: 'reject', reason: 'MIN_ORDER_NOT_MET', message: 'MIN_ORDER_NOT_MET: minimum order for this area is ₹500.00', minOrderPaise: 50000 });
    const j = await (await call(body)).json();
    expect(j.zoneBlock).toMatchObject({ reason: 'MIN_ORDER_NOT_MET', minOrderPaise: 50000 });
  });
  it('legacy: no zones keeps legacy fee and no zone info', async () => {
    h.terms.mockResolvedValue({ kind: 'legacy' });
    const j = await (await call(body)).json();
    expect(j.deliveryFee).toBe(30);
    expect(j.zone).toBeNull();
    expect(j.zoneBlock).toBeNull();
  });
  it('pickup does not consult zones', async () => {
    const j = await (await call({ ...body, fulfillmentType: 'PICKUP' })).json();
    expect(h.terms).not.toHaveBeenCalled();
    expect(j.deliveryFee).toBe(0);
  });
});
