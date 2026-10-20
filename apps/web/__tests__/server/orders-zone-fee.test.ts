import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  matchZone: vi.fn(),
  hasZones: vi.fn(),
  routeDistance: vi.fn(),
  captured: { result: null as any, inputs: null as any },
  prisma: {
    branch: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
    address: { findFirst: vi.fn() },
    combo: { findFirst: vi.fn() }
  }
}));

vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/delivery/zones', async () => {
  const actual = await vi.importActual<typeof import('@/server/delivery/zones')>('@/server/delivery/zones');
  return { ...actual, matchZone: h.matchZone, branchHasActiveZones: h.hasZones };
});
vi.mock('@/server/geo/routing', () => ({ routeDistance: h.routeDistance }));
// Real pricing, but capture its result/inputs and stop right after so we never reach DB writes.
vi.mock('@/server/pricing', async () => {
  const actual = await vi.importActual<typeof import('@/server/pricing')>('@/server/pricing');
  return {
    ...actual,
    pricing: (inp: any) => {
      h.captured.inputs = inp;
      h.captured.result = actual.pricing(inp);
      throw new Error('__STOP_AFTER_PRICING__');
    }
  };
});
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: vi.fn() }));
vi.mock('@/server/payments/online', () => ({ isOnlineMethod: () => false, startOnlinePayment: vi.fn() }));
vi.mock('@/server/category-availability', () => ({ isCategoryAvailableNow: () => ({ available: true }) }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/offers', () => ({
  loadAndApplyOffers: async () => ({ winners: [] }),
  loadOfferByCode: async () => null,
  recordRedemption: vi.fn()
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn() }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn() }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn() }));
vi.mock('@/server/freebies', () => ({
  resolveQualifyingFreebie: async () => null,
  grantFreebieTx: vi.fn(),
  restoreFreebieStock: vi.fn()
}));
vi.mock('@/server/happy-hours', () => ({
  loadRulesForRestaurant: async () => [],
  priceForItem: vi.fn(),
  priceForCombo: (c: any) => ({ rule: null, originalPrice: c.price, effectivePrice: c.price })
}));
vi.mock('@/server/challenges', () => ({ refreshChallengeProgressForOrder: vi.fn() }));
vi.mock('@/server/signup-bonus', () => ({
  previewSignupBonusForUser: async () => ({ appliedAmount: 0 }),
  holdSignupBonusForOrder: vi.fn(),
  commitSignupBonusForOrder: vi.fn(),
  restoreSignupBonusForOrder: vi.fn()
}));
vi.mock('@/server/notify-templates', () => ({ sendDeliveryOtpSms: vi.fn() }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn() }));
vi.mock('@/server/menu-selections', () => ({ resolveLineSelections: vi.fn() }));
vi.mock('@/server/group-scope', () => ({ groupOrderChannel: vi.fn() }));
vi.mock('@/server/operating-hours', () => ({
  isBranchOpenAt: () => ({ isOpen: true, label: 'Open' }),
  isScheduledTimeInsideOpenWindow: () => true
}));

import { placeOrder } from '@/server/orders';

const STOP = '__STOP_AFTER_PRICING__';

// Zone fixtures: fee in PAISE, minOrder in RUPEES (matches DeliveryZone).
const zone = (o: Record<string, unknown> = {}) =>
  ({
    id: 'z1', branchId: 'b1', name: 'Z', type: 'CIRCLE', priority: 1, isActive: true, isDefault: false,
    polygon: null, centerLat: 12.9, centerLng: 77.6, radiusKm: 10, pincodes: [],
    feeBrackets: [{ minSubtotal: 0, charge: 4900 }],
    distanceTiers: [], minOrder: null, etaMinutes: 30, ...o
  }) as any;

// Cart: one combo, Rs 300 x 1 => subtotal 30000 paise.
const baseInput = (o: Record<string, unknown> = {}) =>
  ({
    branchId: 'b1', customerId: 'u1', addressId: 'a1',
    items: [{ comboId: 'c1', quantity: 1 }],
    paymentMethod: 'COD',
    ...o
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.captured.result = null;
  h.captured.inputs = null;
  h.prisma.branch.findUniqueOrThrow.mockResolvedValue({
    id: 'b1', isActive: true, hours: [], taxRatePct: 0, baseDeliveryFee: 30, perKmDeliveryFee: 10,
    packagingFee: 0, latitude: 12.9, longitude: 77.6, restaurantId: 'r1'
  });
  h.prisma.branch.findUnique.mockResolvedValue({
    restaurantId: 'r1',
    restaurant: { allowFreebies: false, parentId: null, selfPickupEnabled: true, scheduledOrdersEnabled: true, dineInEnabled: true }
  });
  h.prisma.address.findFirst.mockResolvedValue({ id: 'a1', latitude: 12.95, longitude: 77.65, postalCode: '560001' });
  h.prisma.combo.findFirst.mockResolvedValue({ id: 'c1', name: 'Combo', price: 300, isAvailable: true, items: [] });
  h.routeDistance.mockResolvedValue({ distanceKm: 3, durationMin: 6 });
  h.matchZone.mockResolvedValue(null);
  h.hasZones.mockResolvedValue(false);
});

describe('placeOrder zone fee authority', () => {
  it('charges the ZONE fee (not legacy base+perKm) for a delivery order inside a zone', async () => {
    h.matchZone.mockResolvedValue(zone());
    await expect(placeOrder(baseInput())).rejects.toThrow(STOP);
    // legacy would be 30 + 10*(3-1) = 50; zone bracket is Rs 49
    expect(h.captured.inputs.deliveryFeeOverride).toBe(49);
    expect(h.captured.result.deliveryFee).toBe(49);
    expect(h.matchZone).toHaveBeenCalledWith('b1', { lat: 12.95, lng: 77.65, pincode: '560001' });
  });

  it('zone free bracket (charge 0) => deliveryFee 0, not legacy', async () => {
    h.matchZone.mockResolvedValue(zone({ feeBrackets: [{ minSubtotal: 0, charge: 0 }] }));
    await expect(placeOrder(baseInput())).rejects.toThrow(STOP);
    expect(h.captured.result.deliveryFee).toBe(0);
  });

  it('rejects when the zone bracket is unavailable (charge -1)', async () => {
    h.matchZone.mockResolvedValue(zone({ feeBrackets: [{ minSubtotal: 0, charge: -1 }] }));
    await expect(placeOrder(baseInput())).rejects.toThrow(/ZONE_UNAVAILABLE/);
    expect(h.captured.inputs).toBeNull();
  });

  it('rejects when no bracket matches the subtotal (fail-closed)', async () => {
    h.matchZone.mockResolvedValue(zone({ feeBrackets: [{ minSubtotal: 999999, charge: 0 }] }));
    await expect(placeOrder(baseInput())).rejects.toThrow(/ZONE_UNAVAILABLE/);
  });

  it('rejects when subtotal is below the zone minOrder', async () => {
    h.matchZone.mockResolvedValue(zone({ minOrder: 500 })); // Rs 500 > Rs 300 cart
    await expect(placeOrder(baseInput())).rejects.toThrow(/MIN_ORDER_NOT_MET/);
    expect(h.captured.inputs).toBeNull();
  });

  it('accepts when subtotal meets minOrder exactly', async () => {
    h.matchZone.mockResolvedValue(zone({ minOrder: 300 }));
    await expect(placeOrder(baseInput())).rejects.toThrow(STOP);
    expect(h.captured.result.deliveryFee).toBe(49);
  });

  it('rejects when zones exist but the address is outside all of them (no default)', async () => {
    h.matchZone.mockResolvedValue(null);
    h.hasZones.mockResolvedValue(true);
    await expect(placeOrder(baseInput())).rejects.toThrow(/ZONE_UNAVAILABLE/);
    expect(h.captured.inputs).toBeNull();
  });

  it('rejects a DELIVERY order with no address on a zoned branch (no bypass)', async () => {
    h.hasZones.mockResolvedValue(true);
    await expect(placeOrder(baseInput({ addressId: undefined }))).rejects.toThrow(/ZONE_UNAVAILABLE/);
    expect(h.captured.inputs).toBeNull();
  });

  it('branch with NO zones keeps the legacy fee unchanged', async () => {
    h.matchZone.mockResolvedValue(null);
    await expect(placeOrder(baseInput())).rejects.toThrow(STOP);
    expect(h.captured.inputs.deliveryFeeOverride).toBeUndefined();
    // haversine (12.9,77.6)->(12.95,77.65) is ~7.8km; legacy = 30 + 10*(d-1)
    expect(h.captured.result.deliveryFee).toBeGreaterThan(50);
    expect(h.captured.result.deliveryFee).not.toBe(49);
  });

  it('PICKUP is unaffected: no zone lookup, no delivery fee', async () => {
    h.matchZone.mockResolvedValue(zone({ feeBrackets: [{ minSubtotal: 0, charge: -1 }], minOrder: 9999 }));
    await expect(placeOrder(baseInput({ fulfillmentType: 'PICKUP', addressId: undefined }))).rejects.toThrow(STOP);
    expect(h.matchZone).not.toHaveBeenCalled();
    expect(h.captured.result.deliveryFee).toBe(0);
    expect(h.captured.inputs.deliveryFeeOverride).toBeUndefined();
  });
});
