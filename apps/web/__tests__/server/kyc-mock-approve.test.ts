/**
 * C13 — a mock verifier PASS must NOT auto-approve a PAN/DL document; it must
 * be left PENDING for manual review. A real verifier PASS still auto-approves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let outcome: any = { status: 'PASS', provider: 'mock' };
let updateData: any = null;

vi.mock('@/server/kyc-verifiers', () => ({ runLiveVerification: async () => outcome }));
vi.mock('@/server/db', () => ({
  prisma: { riderKycDocument: { update: async ({ data }: any) => { updateData = data; return {}; } } }
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { liveVerifyAndPersist } from '@/server/kyc';

beforeEach(() => { updateData = null; });

describe('C13: mock PASS does not auto-approve', () => {
  it('mock PASS on a PAN leaves status unset (PENDING, manual review)', async () => {
    outcome = { status: 'PASS', provider: 'mock' };
    await liveVerifyAndPersist('d1', { type: 'PAN_CARD', number: 'ABCDE1234F' } as any);
    expect(updateData.status).toBeUndefined();
  });

  it('real verifier PASS on a PAN auto-approves', async () => {
    outcome = { status: 'PASS', provider: 'karza' };
    await liveVerifyAndPersist('d1', { type: 'PAN_CARD', number: 'ABCDE1234F' } as any);
    expect(updateData.status).toBe('APPROVED');
  });
});
