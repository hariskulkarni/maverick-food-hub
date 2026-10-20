import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  terms: vi.fn(),
  prisma: {
    branch: { findUniqueOrThrow: vi.fn() },
    address: { findUnique: vi.fn() },
    combo: { findUnique: vi.fn() },
    menuItem: { findFirst: vi.fn() }
  },
  rules: vi.fn()
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/offers', () => ({ loadAndApplyOffers: vi.fn(), loadOfferByCode: vi.fn() }));
vi.mock('@/server/happy-hours', async (orig) => ({
  ...(await orig<typeof import('@/server/happy-hours')>()),
  loadRulesForRestaurant: h.rules
}));
vi.mock('@/server/delivery/placement', () => ({ resolveDeliveryTerms: h.terms }));

import { POST } from '@/app/api/checkout/quote/route';

const call = (b: Record<string, unknown>) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(b) }) as never);
const body = { branchId: 'b1', addressId: 'a1', items: [{ comboId: 'c1', quantity: 1 }] };

beforeEach(() => {
  vi.resetAllMocks();
  h.prisma.branch.findUniqueOrThrow.mockResolvedValue({
    id: 'b1', restaurantId: 'r1', taxRatePct: 0, baseDeliveryFee: 30, perKmDeliveryFee: 10, packagingFee: 0, latitude: 12.9, longitude: 77.6
  });
  h.prisma.address.findUnique.mockResolvedValue({ id: 'a1', latitude: 12.9, longitude: 77.6, postalCode: '560001' });
  h.prisma.combo.findUnique.mockResolvedValue({ id: 'c1', price: 300 });
  h.rules.mockResolvedValue([]);
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

describe('quote subtotal matches placeOrder pricing (happy hour / variant / modifiers)', () => {
  const item = {
    id: 'm1', name: 'Biryani', price: 200, categoryId: 'cat1', category: { id: 'cat1' },
    variants: [{ id: 'v1', name: 'Large', price: 180, isDefault: false, isAvailable: true }],
    modifierGroups: [{
      id: 'g1', name: 'Extras', minSelect: 0, maxSelect: 2, required: false,
      options: [{ id: 'o1', name: 'Raita', priceDelta: 20, isAvailable: true }]
    }]
  };
  const plain = { ...item, variants: [], modifierGroups: [] };
  const hh = {
    id: 'hh1', name: 'HH', scope: 'RESTAURANT', categoryId: null, menuItemId: null, comboId: null,
    discountType: 'PERCENTAGE', percentOff: 50, fixedPrice: null, amountOff: null, minPrice: null,
    validFrom: new Date(0), validTo: null, isActive: true, priority: 1, schedules: []
  };
  // "free above Rs150" bracket evaluated on the subtotal the quote feeds in
  const bracket = ({ subtotalPaise }: { subtotalPaise: number }) => ({
    kind: 'zone', feeRupees: subtotalPaise >= 15000 ? 0 : 49, minOrderPaise: 0, etaMinutes: 30, distanceKm: 3
  });
  beforeEach(() => {
    h.prisma.menuItem.findFirst.mockResolvedValue(plain);
    h.terms.mockImplementation(async (a: { subtotalPaise: number }) => bracket(a));
  });

  it('happy-hour discounted subtotal drops below free threshold -> fee charged, not Free', async () => {
    h.rules.mockResolvedValue([hh]);
    const j = await (await call({ ...body, items: [{ menuItemId: 'm1', quantity: 1 }] })).json();
    expect(h.terms.mock.calls[0][0].subtotalPaise).toBe(10000);
    expect(j.deliveryFee).toBe(49);
    expect(j.subtotal).toBe(100);
  });
  it('variant price replaces base and modifier delta is added after happy hour', async () => {
    h.rules.mockResolvedValue([hh]);
    h.prisma.menuItem.findFirst.mockResolvedValue(item);
    const j = await (await call({
      ...body,
      items: [{ menuItemId: 'm1', quantity: 2, selectedVariantId: 'v1', selectedModifierOptionIds: ['o1'] }]
    })).json();
    // (180 * 50%) + 20 = 110 per unit, x2
    expect(h.terms.mock.calls[0][0].subtotalPaise).toBe(22000);
    expect(j.subtotal).toBe(220);
    expect(j.deliveryFee).toBe(0);
  });
  it('no rules: raw price still used', async () => {
    const j = await (await call({ ...body, items: [{ menuItemId: 'm1', quantity: 1 }] })).json();
    expect(h.terms.mock.calls[0][0].subtotalPaise).toBe(20000);
    expect(j.deliveryFee).toBe(0);
  });
  it('combo happy-hour applies', async () => {
    h.rules.mockResolvedValue([hh]);
    await call(body);
    expect(h.terms.mock.calls[0][0].subtotalPaise).toBe(15000);
  });
});
