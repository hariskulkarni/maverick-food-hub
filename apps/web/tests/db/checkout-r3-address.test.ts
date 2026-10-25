/**
 * Customer audit P1-13 against real Postgres: an address used by an active order cannot be deleted or
 * re-pointed (it would strip / move the order's destination); account deletion waits for active orders.
 */
import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeAll } from 'vitest';

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string } } }));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => h.session) }));

import { prisma } from '@/server/db';
import { DELETE as legacyDelete } from '@/app/api/addresses/[id]/route';
import { DELETE as custDelete, PATCH as custPatch } from '@/app/api/customer/addresses/[id]/route';
import { POST as deleteAccount } from '@/app/api/customer/delete-account/route';

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never;

let branchId = '';
beforeAll(async () => {
  const id = uid();
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: `ao-${id}@test.invalid` } });
  const r = await prisma.restaurant.create({ data: { slug: `ad-${id}`, name: `AD ${id}`, ownerUserId: owner.id } });
  branchId = (await prisma.branch.create({ data: { restaurantId: r.id, name: 'Main', slug: `adb-${id}`, line1: 'x', city: 'y', postalCode: '1' } })).id;
});

async function customerWithOrder(status: 'RECEIVED' | 'OUT_FOR_DELIVERY' | 'DELIVERED') {
  const id = uid();
  const c = await prisma.user.create({ data: { role: 'CUSTOMER', email: `ac-${id}@test.invalid` } });
  const a = await prisma.address.create({ data: { userId: c.id, line1: '1 Road', city: 'Pune', postalCode: '411001' } });
  await prisma.address.create({ data: { userId: c.id, line1: '2 Road', city: 'Pune', postalCode: '411001', isDefault: true } });
  const o = await prisma.order.create({
    data: { code: `AD-${id}`, branchId, customerId: c.id, addressId: a.id, status, subtotal: 100 as any, total: 100 as any, paymentMethod: 'COD' },
  });
  h.session = { user: { id: c.id, role: 'CUSTOMER' } };
  return { c, a, o };
}

describe('P1-13 address in use by an active order', () => {
  it('delete (both routes) is refused while the order is out for delivery; destination intact', async () => {
    const { a, o } = await customerWithOrder('OUT_FOR_DELIVERY');
    expect((await custDelete(new Request('http://x') as never, ctx(a.id))).status).toBe(409);
    expect((await legacyDelete(new Request('http://x') as never, ctx(a.id))).status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).addressId).toBe(a.id);
  });

  it('moving the location is refused; renaming the label is allowed', async () => {
    const { a } = await customerWithOrder('RECEIVED');
    expect((await custPatch(patchReq({ line1: 'Somewhere else' }), ctx(a.id))).status).toBe(409);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: a.id } })).line1).toBe('1 Road');
    expect((await custPatch(patchReq({ label: 'Office', line1: '1 Road' }), ctx(a.id))).status).toBe(200);
  });

  it('after delivery the address can be deleted', async () => {
    const { a } = await customerWithOrder('DELIVERED');
    expect((await custDelete(new Request('http://x') as never, ctx(a.id))).status).toBe(200);
  });

  it('account deletion waits for active orders', async () => {
    const { c, a } = await customerWithOrder('RECEIVED');
    expect((await deleteAccount()).status).toBe(409);
    expect(await prisma.address.count({ where: { id: a.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).email).not.toBeNull();
  });
});
