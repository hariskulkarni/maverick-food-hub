import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  restaurant: { findUnique: vi.fn() },
  branch: { findMany: vi.fn() },
  menuItem: { count: vi.fn() },
  restaurantUser: { count: vi.fn() },
  qrCode: { findFirst: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { evaluateReadiness, type ReadinessSnapshot } from '@/lib/onboarding/readiness';
import { loadReadinessSnapshot } from '@/server/onboarding';

const goodBranch = {
  id: 'b1', name: 'Koramangala', line1: '12, 80 Feet Rd', city: 'Bengaluru', postalCode: '560034',
  latitude: 12.93, longitude: 77.62, serviceRadiusKm: 5, fssaiLicenseNumber: '10020042007183',
  fssaiExpiresOn: '2030-01-01', openDays: 7, activeZones: 1,
};
function snap(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    restaurant: { name: 'Spice Garden', contactPhone: '+91 98765 43210', logoUrl: '/logo.png', gstin: '27AAPFU0939F1ZV' },
    branches: [goodBranch], availableItems: 12, otherStaff: 1, hasQr: true, ...over,
  };
}
const byKey = (r: ReturnType<typeof evaluateReadiness>, k: string) => r.checks.find((c) => c.key === k)!;

describe('evaluateReadiness', () => {
  it('a fully configured restaurant is ready with every check green', () => {
    const r = evaluateReadiness(snap(), new Date('2026-10-24'));
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('blocks on no available menu items', () => {
    const r = evaluateReadiness(snap({ availableItems: 0 }));
    expect(r.ready).toBe(false);
    expect(byKey(r, 'menu')).toMatchObject({ ok: false, required: true, step: 'menu' });
  });

  it('blocks on hours closed all week, missing FSSAI, expired FSSAI, bad phone', () => {
    expect(byKey(evaluateReadiness(snap({ branches: [{ ...goodBranch, openDays: 0 }] })), 'hours').ok).toBe(false);
    expect(byKey(evaluateReadiness(snap({ branches: [{ ...goodBranch, fssaiLicenseNumber: null }] })), 'fssai').detail).toMatch(/14-digit/);
    const expired = evaluateReadiness(snap({ branches: [{ ...goodBranch, fssaiExpiresOn: '2024-01-01' }] }), new Date('2026-10-24'));
    expect(byKey(expired, 'fssai').detail).toMatch(/expired/);
    const phone = evaluateReadiness(snap({ restaurant: { ...snap().restaurant, contactPhone: null } }));
    expect(byKey(phone, 'profile').ok).toBe(false);
    expect(phone.requiredFailing).toBe(1);
  });

  it('delivery passes on a radius fallback, fails with neither zone nor pin', () => {
    const radius = evaluateReadiness(snap({ branches: [{ ...goodBranch, activeZones: 0 }] }));
    expect(byKey(radius, 'delivery')).toMatchObject({ ok: true });
    expect(byKey(radius, 'delivery').detail).toMatch(/radius/);
    const none = evaluateReadiness(snap({ branches: [{ ...goodBranch, activeZones: 0, latitude: null }] }));
    expect(byKey(none, 'delivery').ok).toBe(false);
    expect(byKey(none, 'branch').ok).toBe(false);
  });

  it('no active branch fails every branch-scoped check', () => {
    const r = evaluateReadiness(snap({ branches: [] }));
    for (const k of ['branch', 'fssai', 'hours', 'delivery']) expect(byKey(r, k).ok).toBe(false);
  });

  it('recommended checks never block', () => {
    const r = evaluateReadiness(snap({ restaurant: { ...snap().restaurant, logoUrl: null, gstin: null }, otherStaff: 0, hasQr: false }));
    expect(r.ready).toBe(true);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.key).sort()).toEqual(['gstin', 'logo', 'qr', 'staff']);
  });
});

describe('loadReadinessSnapshot', () => {
  beforeEach(() => Object.values(db).forEach((m) => Object.values(m).forEach((f) => (f as any).mockReset())));

  it('reads only ACTIVE branches of the restaurant and counts open days / zones', async () => {
    db.restaurant.findUnique.mockResolvedValue({ name: 'S', contactPhone: null, logoUrl: null, gstin: null, ownerUserId: 'owner' });
    db.branch.findMany.mockResolvedValue([{
      ...goodBranch, hours: [{ openMin: 660, closeMin: 1380 }, { openMin: 0, closeMin: 0 }], _count: { deliveryZones: 2 },
    }]);
    db.menuItem.count.mockResolvedValue(3);
    db.restaurantUser.count.mockResolvedValue(0);
    db.qrCode.findFirst.mockResolvedValue(null);

    const s = await loadReadinessSnapshot('r1');
    expect(db.branch.findMany.mock.calls[0][0].where).toEqual({ restaurantId: 'r1', isActive: true });
    expect(db.menuItem.count.mock.calls[0][0].where).toMatchObject({ branchId: { in: ['b1'] }, isAvailable: true, category: { isActive: true } });
    expect(db.restaurantUser.count.mock.calls[0][0].where).toEqual({ restaurantId: 'r1', userId: { not: 'owner' } });
    expect(s.branches[0]).toMatchObject({ openDays: 1, activeZones: 2 });
    expect(s).toMatchObject({ availableItems: 3, otherStaff: 0, hasQr: false });
  });
});
