/**
 * Task 9 — rich address fields (landmark / floor / instructions / structured
 * label) persist through customer address create + update and read back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { store: [] as any[], session: null as any };
  const tx = {
    address: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => {
        const row = { id: 'a1', ...data };
        state.store.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.store.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }
    }
  };
  return { state, tx };
});

vi.mock('@/server/auth', () => ({ auth: async () => h.state.session }));
vi.mock('@/server/db', () => ({
  prisma: {
    $transaction: async (fn: any) => fn(h.tx),
    address: {
      ...h.tx.address,
      findUnique: async ({ where }: any) => h.state.store.find((r) => r.id === where.id) ?? null,
      findMany: async () => h.state.store
    }
  }
}));

import { POST, GET } from '@/app/api/customer/addresses/route';
import { PATCH } from '@/app/api/customer/addresses/[id]/route';

const req = (body: unknown) => ({ json: async () => body }) as any;
const base = { label: 'Home', line1: '12 MG Road', city: 'Guntur', postalCode: '522001' };

beforeEach(() => {
  h.state.store = [];
  h.state.session = { user: { id: 'u1', role: 'CUSTOMER' } };
});

describe('rich address fields', () => {
  it('create persists and reads back the new fields', async () => {
    const res = await POST(
      req({
        ...base,
        landmark: 'Opp. City Mall',
        floor: '3rd floor',
        instructions: 'Ring twice',
        labelType: 'OTHER',
        labelName: 'Mom'
      })
    );
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created).toMatchObject({
      landmark: 'Opp. City Mall',
      floor: '3rd floor',
      instructions: 'Ring twice',
      labelType: 'OTHER',
      labelName: 'Mom'
    });
    const list = await (await GET()).json();
    expect(list[0]).toMatchObject({ landmark: 'Opp. City Mall', labelType: 'OTHER', labelName: 'Mom' });
  });

  it('rejects an invalid labelType', async () => {
    const res = await POST(req({ ...base, labelType: 'VILLA' }));
    expect(res.status).toBe(400);
  });

  it('update persists the new fields', async () => {
    await POST(req(base));
    const res = await PATCH(
      req({ landmark: 'Near temple', floor: '1', instructions: 'Call on arrival', labelType: 'WORK' }),
      { params: Promise.resolve({ id: 'a1' }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      landmark: 'Near temple',
      floor: '1',
      instructions: 'Call on arrival',
      labelType: 'WORK'
    });
  });
});
