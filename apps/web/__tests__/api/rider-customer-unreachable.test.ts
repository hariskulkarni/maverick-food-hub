/**
 * POST /api/rider/assignments/[id]/customer-unreachable — auth, ownership,
 * allowed states, escalation creation (idempotent), note validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let assignment: any;
let existingEscalation: any;
const transitions: any[] = [];
const escalations: any[] = [];
const assignmentUpdates: any[] = [];
let transitionImpl: (orderId: string, next: string) => Promise<unknown>;

vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/orders', () => {
  class OrderTransitionError extends Error {}
  return {
    OrderTransitionError,
    transitionOrder: async (orderId: string, next: string, opts: any) => {
      transitions.push({ orderId, next, opts });
      return transitionImpl(orderId, next);
    }
  };
});
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async ({ where }: any) => (where.userId === 'u1' ? { id: 'rp1' } : { id: 'rp-other' }) },
    riderAssignment: {
      findUnique: async ({ where }: any) => (assignment && where.id === assignment.id ? assignment : null),
      update: async ({ data }: any) => { assignmentUpdates.push(data); return { ...assignment, ...data }; }
    },
    orderEscalation: {
      findFirst: async () => existingEscalation,
      create: async ({ data }: any) => { escalations.push(data); return { id: 'e1', ...data }; }
    }
  }
}));

import { POST } from '@/app/api/rider/assignments/[id]/customer-unreachable/route';
import { OrderTransitionError } from '@/server/orders';

const call = (body: unknown, id = 'a1') =>
  POST({ json: async () => body } as any, { params: Promise.resolve({ id }) });

beforeEach(() => {
  session = { user: { id: 'u1', role: 'RIDER' } };
  assignment = { id: 'a1', riderId: 'rp1', orderId: 'o1', status: 'PICKED_UP', notes: '[reached-customer 2026-10-24T10:00:00Z]' };
  existingEscalation = null;
  transitions.length = 0;
  escalations.length = 0;
  assignmentUpdates.length = 0;
  transitionImpl = async () => ({});
});

describe('POST customer-unreachable', () => {
  it('rejects non-riders and missing sessions', async () => {
    session = { user: { id: 'u1', role: 'CUSTOMER' } };
    expect((await call({})).status).toBe(403);
    session = null;
    expect((await call({})).status).toBe(403);
    expect(transitions).toHaveLength(0);
  });

  it("404s for another rider's assignment or an unknown id", async () => {
    session = { user: { id: 'u2', role: 'RIDER' } };
    expect((await call({})).status).toBe(404);
    session = { user: { id: 'u1', role: 'RIDER' } };
    expect((await call({}, 'nope')).status).toBe(404);
    expect(transitions).toHaveLength(0);
    expect(escalations).toHaveLength(0);
  });

  it('transitions the order, stamps the note and opens a HIGH escalation', async () => {
    const r = await call({ note: 'Called twice, no answer' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, orderStatus: 'CUSTOMER_UNREACHABLE' });
    expect(transitions[0]).toMatchObject({ orderId: 'o1', next: 'CUSTOMER_UNREACHABLE', opts: { actorId: 'u1', note: 'Called twice, no answer' } });
    expect(assignmentUpdates[0].notes).toContain('[customer-unreachable] Called twice, no answer');
    expect(escalations).toEqual([
      { orderId: 'o1', type: 'CUSTOMER_UNREACHABLE', severity: 'HIGH', message: 'Rider could not reach customer: Called twice, no answer' }
    ]);
  });

  it('works without a body/note and does not double-open an escalation', async () => {
    existingEscalation = { id: 'e0' };
    const r = await POST({ json: async () => { throw new Error('no body'); } } as any, { params: Promise.resolve({ id: 'a1' }) });
    expect(r.status).toBe(200);
    expect(transitions[0].opts.note).toBe('Rider reports customer unreachable');
    expect(escalations).toHaveLength(0);
  });

  it('409s when the order is not at the customer yet (transition not allowed)', async () => {
    transitionImpl = async () => { throw new OrderTransitionError('Cannot transition PICKED_UP → CUSTOMER_UNREACHABLE'); };
    const r = await call({});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/reached the customer/);
    expect(assignmentUpdates).toHaveLength(0);
    expect(escalations).toHaveLength(0);
  });

  it('409s when the assignment is not in PICKED_UP', async () => {
    for (const status of ['PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED']) {
      assignment.status = status;
      expect((await call({})).status).toBe(409);
    }
    expect(transitions).toHaveLength(0);
  });

  it('400s on an over-long note', async () => {
    const r = await call({ note: 'x'.repeat(501) });
    expect(r.status).toBe(400);
    expect(transitions).toHaveLength(0);
  });
});
