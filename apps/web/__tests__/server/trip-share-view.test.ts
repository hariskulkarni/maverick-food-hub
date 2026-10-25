import { describe, it, expect, vi, beforeEach } from 'vitest';

let share: any;
let assignment: any;
let ping: any;
vi.mock('@/server/db', () => ({
  prisma: {
    tripShare: { findUnique: async () => share },
    riderAssignment: { findFirst: async ({ where }: any) => (assignment && where.riderId === share.riderId ? assignment : null) },
    deliveryLocationPing: { findFirst: async () => ping }
  }
}));

import { loadTripShareView } from '@/server/trip-share';

const now = new Date('2026-10-24T10:00:00Z');
beforeEach(() => {
  share = {
    isActive: true,
    expiresAt: new Date('2026-10-24T12:00:00Z'),
    assignmentId: 'a1',
    riderId: 'r1',
    rider: { vehicleType: 'BIKE', currentLat: 1, currentLng: 2, updatedAt: now, user: { name: 'Ravi Kumar' } }
  };
  assignment = {
    status: 'PICKED_UP',
    orderId: 'o1',
    order: { status: 'OUT_FOR_DELIVERY', branch: { name: 'Main', latitude: 12.9, longitude: 77.6, restaurant: { name: 'Spice Hub' } } }
  };
  ping = { lat: 12.95, lng: 77.62, createdAt: now };
});

describe('loadTripShareView', () => {
  it('returns rider location and status without customer PII', async () => {
    const v = await loadTripShareView('abcd2345ef', now);
    expect(v).toMatchObject({
      state: 'active',
      riderFirstName: 'Ravi',
      statusLabel: 'Out for Delivery',
      restaurantName: 'Spice Hub',
      rider: { lat: 12.95, lng: 77.62 }
    });
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/Kumar|address|phone|customer/i);
  });
  it('ends when the delivery is complete', async () => {
    assignment.status = 'DELIVERED';
    expect((await loadTripShareView('abcd2345ef', now)).state).toBe('ended');
    assignment.status = 'PICKED_UP';
    assignment.order.status = 'CANCELLED_BY_RESTAURANT';
    expect((await loadTripShareView('abcd2345ef', now)).state).toBe('ended');
  });
  it('expires after expiresAt or when deactivated, and hides location', async () => {
    share.expiresAt = new Date('2026-10-24T09:00:00Z');
    const v: any = await loadTripShareView('abcd2345ef', now);
    expect(v.state).toBe('expired');
    expect(v.rider).toBeUndefined();
    share.expiresAt = new Date('2026-10-24T12:00:00Z');
    share.isActive = false;
    expect((await loadTripShareView('abcd2345ef', now)).state).toBe('expired');
  });
  it('rejects unknown and malformed tokens', async () => {
    share = null;
    expect((await loadTripShareView('abcd2345ef', now)).state).toBe('not_found');
    expect((await loadTripShareView('../etc', now)).state).toBe('not_found');
  });
});
