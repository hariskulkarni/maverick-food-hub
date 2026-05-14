import { describe, it, expect } from 'vitest';
import { defaultScorer } from '../../src/server/rider-allocator';

describe('defaultScorer', () => {
  const branch = { lat: 12.97, lng: 77.64 };
  const delivery = { lat: 12.97, lng: 77.64 };

  it('prefers riders closer to the branch', () => {
    const a = defaultScorer({ rider: { id: 'A', lat: 12.97, lng: 77.64, load: 0, rating: 5 }, branch, delivery });
    const b = defaultScorer({ rider: { id: 'B', lat: 13.00, lng: 77.66, load: 0, rating: 5 }, branch, delivery });
    expect(a).toBeLessThan(b);
  });
  it('penalizes riders with higher load', () => {
    const a = defaultScorer({ rider: { id: 'A', lat: 12.97, lng: 77.64, load: 0, rating: 5 }, branch, delivery });
    const b = defaultScorer({ rider: { id: 'B', lat: 12.97, lng: 77.64, load: 3, rating: 5 }, branch, delivery });
    expect(a).toBeLessThan(b);
  });
  it('rewards higher-rated riders slightly', () => {
    const a = defaultScorer({ rider: { id: 'A', lat: 12.97, lng: 77.64, load: 0, rating: 5 }, branch, delivery });
    const b = defaultScorer({ rider: { id: 'B', lat: 12.97, lng: 77.64, load: 0, rating: 4 }, branch, delivery });
    expect(a).toBeLessThan(b);
  });
});
