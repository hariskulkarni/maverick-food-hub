import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loyaltyEarnCopy, loyaltyPointsForSubtotal } from '@/lib/loyalty';

// Customer audit P1-12 / P2-18: copy derives from the constants the server uses; no placeholders.
describe('loyalty constants', () => {
  it('earn rate matches the order machine (5 pts per full ₹100)', () => {
    expect(loyaltyPointsForSubtotal(99)).toBe(0);
    expect(loyaltyPointsForSubtotal(250)).toBe(10);
    expect(loyaltyEarnCopy()).toMatch(/5 pts for every ₹100/);
    expect(loyaltyEarnCopy()).toMatch(/1 pt = ₹1/);
  });
  it('profile page has no wrong rate, fake milestone or "coming soon" placeholders', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/app/(customer)/r/[slug]/me/me-client.tsx'), 'utf8');
    expect(src).not.toMatch(/1 pt for every ₹10/);
    expect(src).not.toMatch(/₹50 cashback/);
    expect(src).not.toMatch(/coming soon/i);
    expect(src).not.toMatch(/Saved cards/);
  });
  it('the order machine earns through the shared helper', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/server/orders.ts'), 'utf8');
    expect(src).toMatch(/loyaltyPointsForSubtotal\(/);
  });
});
