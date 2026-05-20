/**
 * Unit tests for the pure nearby-restaurant filter (server/discovery.ts).
 * Property under test (strictest rule): a restaurant qualifies only when a
 * branch is within BOTH the platform discovery radius AND that branch's own
 * serviceRadiusKm; results are nearest-first and annotated with the nearest
 * qualifying branch.
 *
 * Pure function, no mocks needed. Distances use real lat/lng around a base
 * point; ~0.009° ≈ 1 km of latitude, which we use to place test branches.
 */
import { describe, it, expect } from 'vitest';
import { filterNearbyRestaurants, type BranchGeo } from '@/server/discovery';

// Base customer location.
const LOC = { lat: 16.3, lng: 80.45 };
// ~1.11 km north per 0.01 latitude. Helper to place a branch N km north.
const kmNorth = (km: number) => ({ lat: LOC.lat + km / 111, lng: LOC.lng });

function branch(id: string, km: number, serviceRadiusKm = 7): BranchGeo {
  const p = kmNorth(km);
  return { id, latitude: p.lat, longitude: p.lng, serviceRadiusKm };
}

interface R { id: string; branches: BranchGeo[] }

describe('filterNearbyRestaurants', () => {
  it('includes a restaurant whose branch is inside both radii, with the distance', () => {
    const r: R[] = [{ id: 'near', branches: [branch('b1', 2)] }];
    const out = filterNearbyRestaurants(LOC, 7, r);
    expect(out).toHaveLength(1);
    expect(out[0].restaurant.id).toBe('near');
    expect(out[0].branchId).toBe('b1');
    // ~2 km ⇒ ~2000 m (allow generous tolerance for haversine vs flat approx)
    expect(out[0].distanceM).toBeGreaterThan(1800);
    expect(out[0].distanceM).toBeLessThan(2200);
  });

  it('excludes a branch beyond the platform discovery radius', () => {
    const r: R[] = [{ id: 'far', branches: [branch('b1', 9 /*km*/, 20 /*delivers far*/)] }];
    // Discovery radius 7 km ⇒ a 9 km branch is out even though it delivers 20 km.
    expect(filterNearbyRestaurants(LOC, 7, r)).toHaveLength(0);
  });

  it("excludes a branch within discovery radius but outside the branch's own serviceRadiusKm", () => {
    // 5 km away, but the branch only delivers 3 km ⇒ it won't deliver to us.
    const r: R[] = [{ id: 'tooFarToDeliver', branches: [branch('b1', 5, 3)] }];
    expect(filterNearbyRestaurants(LOC, 7, r)).toHaveLength(0);
  });

  it('picks the nearest qualifying branch when several qualify', () => {
    const r: R[] = [{ id: 'multi', branches: [branch('far', 4), branch('near', 1)] }];
    const out = filterNearbyRestaurants(LOC, 7, r);
    expect(out[0].branchId).toBe('near');
  });

  it('sorts results nearest-first', () => {
    const r: R[] = [
      { id: 'b', branches: [branch('x', 5)] },
      { id: 'a', branches: [branch('y', 1)] },
      { id: 'c', branches: [branch('z', 3)] },
    ];
    expect(filterNearbyRestaurants(LOC, 7, r).map((m) => m.restaurant.id)).toEqual(['a', 'c', 'b']);
  });

  it('ignores branches with missing coordinates', () => {
    const r: R[] = [{ id: 'noGeo', branches: [{ id: 'b1', latitude: null, longitude: null, serviceRadiusKm: 7 }] }];
    expect(filterNearbyRestaurants(LOC, 7, r)).toHaveLength(0);
  });

  it('respects a tightened platform radius even when branches deliver far', () => {
    const r: R[] = [{ id: 'r', branches: [branch('b1', 2, 20)] }];
    expect(filterNearbyRestaurants(LOC, 1, r)).toHaveLength(0); // 2km branch, 1km platform radius
    expect(filterNearbyRestaurants(LOC, 3, r)).toHaveLength(1);
  });
});
