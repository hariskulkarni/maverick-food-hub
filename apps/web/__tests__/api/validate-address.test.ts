import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
vi.mock('@/server/db', () => ({ prisma: { branch: { findUnique: (a: unknown) => findUnique(a) } } }));
vi.mock('@/server/branch-pause', () => ({ isPaused: vi.fn(async () => ({ paused: false })) }));
const matchZone = vi.fn();
vi.mock('@/server/delivery/zones', async () => {
  const actual = await vi.importActual<typeof import('@/server/delivery/zones')>('@/server/delivery/zones');
  return { ...actual, matchZone: (...a: unknown[]) => matchZone(...a) };
});

import { POST } from '@/app/api/checkout/validate-address/route';

const branch = { id: 'b1', latitude: 12.9, longitude: 77.6, serviceRadiusKm: 5, isActive: true };
const call = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as never);

const zone = (over: Record<string, unknown> = {}) => ({
  id: 'z1', type: 'CIRCLE', minOrder: 150, etaMinutes: 35,
  feeBrackets: [{ minSubtotal: 0, charge: 4000 }, { minSubtotal: 50000, charge: 0 }],
  distanceTiers: [], ...over,
});

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(branch);
  matchZone.mockReset();
});

describe('validate-address zones', () => {
  it('zone match returns server-computed fee/min/eta', async () => {
    matchZone.mockResolvedValue(zone());
    const res = await call({ branchId: 'b1', lat: 12.91, lng: 77.61, pincode: '560001', subtotalPaise: 10000 });
    const j = await res.json();
    expect(matchZone).toHaveBeenCalledWith('b1', { lat: 12.91, lng: 77.61, pincode: '560001' });
    expect(j).toMatchObject({ ok: true, feePaise: 4000, minOrderPaise: 15000, etaMinutes: 35 });
  });

  it('free-delivery bracket at higher subtotal', async () => {
    matchZone.mockResolvedValue(zone());
    const j = await (await call({ branchId: 'b1', lat: 12.91, lng: 77.61, subtotalPaise: 60000 })).json();
    expect(j.feePaise).toBe(0);
  });

  it('unavailable bracket is rejected with reason', async () => {
    matchZone.mockResolvedValue(zone({ feeBrackets: [{ minSubtotal: 0, charge: -1 }] }));
    const j = await (await call({ branchId: 'b1', lat: 12.91, lng: 77.61 })).json();
    expect(j.ok).toBe(false);
    expect(j.reason).toBe('ZONE_UNAVAILABLE');
  });

  it('no zones -> legacy radius path unchanged', async () => {
    matchZone.mockResolvedValue(null);
    const near = await (await call({ branchId: 'b1', lat: 12.9, lng: 77.6 })).json();
    expect(near).toEqual({ ok: true, distanceKm: 0, serviceRadiusKm: 5 });
    const far = await (await call({ branchId: 'b1', lat: 14, lng: 77.6 })).json();
    expect(far.ok).toBe(false);
    expect(far.reason).toBe('OUT_OF_RANGE');
    expect(far.feePaise).toBeUndefined();
  });

  it('ignores client-supplied fee fields', async () => {
    matchZone.mockResolvedValue(zone());
    const j = await (await call({ branchId: 'b1', lat: 12.91, lng: 77.61, subtotalPaise: 10000, feePaise: 1, deliveryFee: 1 })).json();
    expect(j.feePaise).toBe(4000);
  });
});
