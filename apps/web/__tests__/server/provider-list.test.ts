/**
 * H17 — Razorpay must not appear in the admin integration wizard (its customer
 * browser handoff is unimplemented). It stays in the PROVIDERS registry so a
 * stored credential still resolves.
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_LIST, PROVIDERS } from '@/server/integrations/providers';

describe('H17: Razorpay hidden from the wizard', () => {
  it('PROVIDER_LIST does not include Razorpay', () => {
    expect(PROVIDER_LIST.some((p) => p.key === 'RAZORPAY')).toBe(false);
  });
  it('PhonePe remains available in the wizard', () => {
    expect(PROVIDER_LIST.some((p) => p.key === 'PHONEPE')).toBe(true);
  });
  it('Razorpay stays in the PROVIDERS registry (credential still resolves)', () => {
    expect(PROVIDERS.RAZORPAY).toBeTruthy();
  });
});
