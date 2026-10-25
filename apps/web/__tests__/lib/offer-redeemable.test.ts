/** Lead finding (a): dine-in-only offers are not creatable and are labelled. */
import { describe, it, expect } from 'vitest';
import { isRedeemableYet, CREATABLE_OFFER_TYPES } from '@/app/admin/offers/offers-client';

describe('offer redeemability', () => {
  it('ONLINE_TO_DINE_IN and dine-in-only offers are flagged; others are fine', () => {
    expect(isRedeemableYet({ type: 'ONLINE_TO_DINE_IN', redeemChannel: 'DINE_IN' })).toBe(false);
    expect(isRedeemableYet({ type: 'PERCENTAGE', redeemChannel: 'DINE_IN' })).toBe(false);
    expect(isRedeemableYet({ type: 'PERCENTAGE', redeemChannel: 'ANY' })).toBe(true);
    expect(isRedeemableYet({ type: 'DINE_IN_TO_ONLINE', redeemChannel: 'ONLINE' })).toBe(true);
  });
  it('the editor cannot create ONLINE_TO_DINE_IN', () => {
    expect(CREATABLE_OFFER_TYPES).not.toContain('ONLINE_TO_DINE_IN');
    expect(CREATABLE_OFFER_TYPES).toContain('DINE_IN_TO_ONLINE');
  });
});
