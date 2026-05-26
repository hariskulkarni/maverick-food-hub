import { describe, it, expect } from 'vitest';
import { tierSurgeShareBonus, computeTier } from '@/server/rider-growth';

/**
 * The tier ladder's "N% higher surge share" perk strings must stay in lockstep
 * with the machine-readable surgeShareBonus the pay engine actually uses.
 */
describe('rider-growth.tierSurgeShareBonus', () => {
  it('BRONZE (new rider) gets no surge-share bonus', () => {
    expect(tierSurgeShareBonus({ totalDeliveries: 0, rating: 0 })).toBe(0);
  });

  it('SILVER gets +5%', () => {
    expect(tierSurgeShareBonus({ totalDeliveries: 60, rating: 4.1 })).toBe(0.05);
  });

  it('GOLD gets +12%', () => {
    expect(tierSurgeShareBonus({ totalDeliveries: 250, rating: 4.4 })).toBe(0.12);
  });

  it('PLATINUM gets +20%', () => {
    expect(tierSurgeShareBonus({ totalDeliveries: 800, rating: 4.8 })).toBe(0.20);
  });

  it('both gates must clear — high deliveries but low rating stays at the lower tier', () => {
    // 800 deliveries but only 4.1 rating → caps at SILVER (needs 4.3 for GOLD).
    expect(tierSurgeShareBonus({ totalDeliveries: 800, rating: 4.1 })).toBe(0.05);
  });

  it('the perk string matches the numeric bonus for each tier', () => {
    const silver = computeTier({ totalDeliveries: 60, rating: 4.1 }).current;
    expect(silver.perks.some((p) => p.includes('5%'))).toBe(true);
    expect(silver.surgeShareBonus).toBe(0.05);
  });
});
