/**
 * P1-10 KOT shows variant/modifiers/notes/combo/freebie/fulfilment+table in IST.
 * P2-13 staff boards never select full User rows. P2-15 active orders load
 * separately from the recent window.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/api/admin/orders/_helpers', () => ({
  requireOrderAdminScope: async () => ({ session: { user: { id: 'k1', role: 'KITCHEN' } }, scopeRestaurantId: 'A' }),
  orderScopeWhere: (id: string) => ({ id }),
}));
vi.mock('@/server/db', () => ({
  prisma: {
    order: {
      findFirst: async () => ({
        code: 'FL-1',
        placedAt: new Date('2026-10-24T19:00:00Z'), // 00:30 IST
        fulfillmentType: 'DINE_IN',
        scheduledFor: null,
        customerNotes: 'Ring twice',
        branch: { name: 'Indiranagar' },
        reservation: { table: { name: 'T4' } },
        items: [
          { quantity: 2, name: 'Chicken Biryani', selectedVariantName: 'Full', modifiersSummary: 'Extra raita', notes: 'less spicy', isFreebie: false, combo: null },
          { quantity: 1, name: 'Family Combo', selectedVariantName: null, modifiersSummary: null, notes: null, isFreebie: false, combo: { items: [{ quantity: 2, menuItem: { name: 'Coke' } }] } },
          { quantity: 1, name: 'Gulab Jamun', selectedVariantName: null, modifiersSummary: null, notes: null, isFreebie: true, combo: null },
        ],
      }),
    },
  },
}));

import { GET as kot } from '@/app/api/admin/orders/[id]/kot/route';
import { ADMIN_BOARD_INCLUDE, KITCHEN_BOARD_INCLUDE, loadAdminBoardOrders, ACTIVE_BOARD_STATUSES, STAFF_USER_SELECT } from '@/server/staff-orders';

describe('KOT', () => {
  it('prints options, notes, combo parts, gifts, service + IST time', async () => {
    const html = await (await kot({} as any, { params: Promise.resolve({ id: 'o1' }) })).text();
    expect(html).toContain('Full · Extra raita');
    expect(html).toContain('Note: less spicy');
    expect(html).toContain('↳ Coke ×2');
    expect(html).toContain('[FREE GIFT]');
    expect(html).toContain('Dine-in · Table T4');
    expect(html).toMatch(/25 Oct 2026, 12:30\s?am/i);
  });
});

describe('staff order shapes', () => {
  it('customer and rider users are {id,name,phone} only', () => {
    expect(STAFF_USER_SELECT).toEqual({ id: true, name: true, phone: true });
    expect(ADMIN_BOARD_INCLUDE.customer).toEqual({ select: STAFF_USER_SELECT });
    expect(ADMIN_BOARD_INCLUDE.assignment.include.rider.include.user).toEqual({ select: STAFF_USER_SELECT });
    expect(KITCHEN_BOARD_INCLUDE.customer).toEqual({ select: STAFF_USER_SELECT });
  });

  it('admin board = all active orders + latest 100, deduped, newest first', async () => {
    const calls: any[] = [];
    const old = { id: 'old', placedAt: '2026-10-01T00:00:00Z', status: 'PREPARING' };
    const recent = [{ id: 'r1', placedAt: '2026-10-25T00:00:00Z', status: 'DELIVERED' }, old];
    const fake = { order: { findMany: async (args: any) => { calls.push(args); return args.take ? recent : [old]; } } };
    const rows = await loadAdminBoardOrders(fake, ['b1']);
    expect(calls[0].where.status).toEqual({ in: ACTIVE_BOARD_STATUSES });
    expect(calls[0].take).toBeUndefined();
    expect(rows.map((r) => r.id)).toEqual(['r1', 'old']);
  });
});
