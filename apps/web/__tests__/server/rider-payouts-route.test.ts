/**
 * C6 — rider payout requests must be recorded as REQUESTED (settled out-of-band
 * by an admin), never self-reported as PAID with a fabricated reference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = { user: { id: 'u1', role: 'RIDER' } };
let created: any = null;
let profileRow: any = { id: 'rp1', user: { isTestAccount: false } };

vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/rider-payments', () => ({ computeAvailableBalance: async () => 1000 }));
vi.mock('@/server/db', () => {
  const tx = {
    $executeRaw: async () => 0, // advisory lock (P1-6)
    riderPayout: {
      create: async ({ data }: any) => {
        created = { ...data };
        return { requestedAt: new Date(), processedAt: null, reference: null, note: null, ...data, id: 'po1' };
      }
    }
  };
  return {
    prisma: {
      riderProfile: { findUnique: async () => profileRow },
      $transaction: async (fn: any) => fn(tx)
    }
  };
});

import { POST } from '@/app/api/rider/payouts/route';

const post = () =>
  POST(new Request('http://x/api/rider/payouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 200, method: 'UPI', upiId: 'rider@upi' })
  }));

beforeEach(() => {
  session = { user: { id: 'u1', role: 'RIDER' } };
  created = null;
  profileRow = { id: 'rp1', user: { isTestAccount: false } };
});

describe('C6: rider payout request', () => {
  it('records the payout as REQUESTED with no fake reference or processedAt', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(created.status).toBe('REQUESTED');
    expect(created.reference).toBeUndefined(); // not set
    expect(created.processedAt).toBeUndefined();
    const body = await res.json();
    expect(body.payout.status).toBe('REQUESTED');
    expect(body.payout.processedAt).toBeNull();
  });
});

describe('test riders', () => {
  it('a pre-launch test rider cannot request a payout', async () => {
    profileRow = { id: 'rp1', user: { isTestAccount: true } };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('test_account');
    expect(created).toBeNull();
  });
});

