/**
 * Public live-trip view for a rider's share link (/trip/<token>).
 *
 * The token is the only credential, so the DTO is deliberately minimal:
 * rider first name + vehicle type, the order's status label, the restaurant
 * name/pin, and the rider's last known location. No customer name, phone,
 * address or drop location, and no order code.
 *
 * The link is live only while the share is active, not past expiresAt, and the
 * linked delivery is still in progress. Once the trip ends (delivered /
 * cancelled / rejected, or the order reaches a terminal status) the view
 * reports `ended` and stops returning a location.
 */
import { prisma } from './db';
import { STATUS_LABELS } from '@/lib/utils';

export type TripShareView =
  | { state: 'not_found' }
  | { state: 'expired' | 'ended'; riderFirstName: string | null }
  | {
      state: 'active';
      riderFirstName: string | null;
      vehicleType: string | null;
      statusLabel: string;
      restaurantName: string | null;
      restaurant: { lat: number; lng: number } | null;
      rider: { lat: number; lng: number; updatedAt: string } | null;
      expiresAt: string;
    };

const ENDED_ASSIGNMENT = new Set(['DELIVERED', 'CANCELLED', 'REJECTED']);
const ENDED_ORDER = /^(DELIVERED|COMPLETED|CANCELLED.*|REFUND.*|DELIVERY_FAILED|PAYMENT_FAILED)$/;

const ASSIGNMENT_LABEL: Record<string, string> = {
  PENDING: 'Rider assigned',
  ACCEPTED: 'Heading to the restaurant',
  PICKED_UP: 'Order picked up, on the way'
};

function firstName(name: string | null | undefined): string | null {
  const t = name?.trim();
  return t ? t.split(/\s+/)[0] : null;
}

/** Plausible token shape (genShareToken alphabet); avoids DB hits on junk. */
export function isTokenShape(token: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(token);
}

export async function loadTripShareView(token: string, now = new Date()): Promise<TripShareView> {
  if (!isTokenShape(token)) return { state: 'not_found' };
  const share = await prisma.tripShare.findUnique({
    where: { token },
    select: {
      isActive: true,
      expiresAt: true,
      assignmentId: true,
      riderId: true,
      rider: {
        select: {
          vehicleType: true,
          currentLat: true,
          currentLng: true,
          updatedAt: true,
          user: { select: { name: true } }
        }
      }
    }
  });
  if (!share) return { state: 'not_found' };
  const riderFirstName = firstName(share.rider?.user?.name);
  if (!share.isActive || share.expiresAt <= now) return { state: 'expired', riderFirstName };

  let statusLabel = 'Rider on shift';
  let restaurantName: string | null = null;
  let restaurant: { lat: number; lng: number } | null = null;
  let orderId: string | null = null;
  if (share.assignmentId) {
    const a = await prisma.riderAssignment.findFirst({
      // The assignment must belong to the sharing rider.
      where: { id: share.assignmentId, riderId: share.riderId },
      select: {
        status: true,
        orderId: true,
        order: {
          select: {
            status: true,
            branch: { select: { name: true, latitude: true, longitude: true, restaurant: { select: { name: true } } } }
          }
        }
      }
    });
    if (!a || ENDED_ASSIGNMENT.has(a.status) || ENDED_ORDER.test(a.order.status)) {
      return { state: 'ended', riderFirstName };
    }
    orderId = a.orderId;
    statusLabel = a.order.status === 'OUT_FOR_DELIVERY'
      ? STATUS_LABELS.OUT_FOR_DELIVERY
      : ASSIGNMENT_LABEL[a.status] ?? STATUS_LABELS[a.order.status] ?? 'In progress';
    const b = a.order.branch;
    restaurantName = b.restaurant?.name ?? b.name;
    if (b.latitude != null && b.longitude != null) restaurant = { lat: b.latitude, lng: b.longitude };
  }

  // Last known location: newest ping for this rider (for this order when there
  // is one), else the profile's current coordinates.
  const ping = await prisma.deliveryLocationPing.findFirst({
    where: { riderId: share.riderId, ...(orderId ? { orderId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { lat: true, lng: true, createdAt: true }
  });
  let rider: { lat: number; lng: number; updatedAt: string } | null = null;
  if (ping) rider = { lat: ping.lat, lng: ping.lng, updatedAt: ping.createdAt.toISOString() };
  else if (share.rider?.currentLat != null && share.rider?.currentLng != null) {
    rider = { lat: share.rider.currentLat, lng: share.rider.currentLng, updatedAt: share.rider.updatedAt.toISOString() };
  }

  return {
    state: 'active',
    riderFirstName,
    vehicleType: share.rider?.vehicleType ?? null,
    statusLabel,
    restaurantName,
    restaurant,
    rider,
    expiresAt: share.expiresAt.toISOString()
  };
}
