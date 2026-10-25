import { describe, it, expect } from 'vitest';
import { CUSTOMER_ORDER_INCLUDE } from '@/server/customer-order-view';

// Customer audit P1-5: the order page must not ship the rider's user row or raw gateway data.
function hasKeyDeep(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.entries(obj as Record<string, unknown>).some(([k, v]) => k === key || hasKeyDeep(v, key));
}

describe('customer order page include', () => {
  it('selects only what the tracker renders', () => {
    const inc = CUSTOMER_ORDER_INCLUDE as any;
    expect(inc.assignment.select.rider.select.user.select).toEqual({ name: true, phone: true });
    expect(hasKeyDeep(inc, 'providerData')).toBe(false);
    expect(hasKeyDeep(inc, 'email')).toBe(false);
    expect(inc.branch).not.toBe(true);
    expect(inc.payments).not.toBe(true);
  });
});
