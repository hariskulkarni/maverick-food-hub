/** KYC gate waiver for pre-launch test riders (they can only carry test orders). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ isTest: false, docs: [] as any[] }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderKycDocument: { findMany: async () => h.docs },
    riderProfile: { findUnique: async () => ({ user: { isTestAccount: h.isTest } }) },
  },
}));
vi.mock('@/server/platform-settings', () => ({ getRiderKycGate: async () => true }));

import { riderKycGate } from '@/server/rider-kyc-gate';

beforeEach(() => { h.isTest = false; h.docs = []; });

describe('riderKycGate', () => {
  it('blocks a real rider with no documents', async () => {
    const r = await riderKycGate('rp1');
    expect(r.canGoOnline).toBe(false);
    expect(r.testAccountExempt).toBeUndefined();
  });
  it('waives the gate for a test rider and says so', async () => {
    h.isTest = true;
    const r = await riderKycGate('rp1');
    expect(r).toMatchObject({ canGoOnline: true, message: null, testAccountExempt: true });
    expect(r.blockingTypes.length).toBeGreaterThan(0); // still reported, just not enforced
  });
});
