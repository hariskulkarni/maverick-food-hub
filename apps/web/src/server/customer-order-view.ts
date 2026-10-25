import type { Prisma } from '@prisma/client';

/**
 * What the customer order tracker (orders/[id]) loads. P1-5: explicit selects — the result is
 * serialised to the browser, so it must not carry the rider's user row (email, session/push tokens…),
 * branch internals or raw gateway providerData.
 */
export const CUSTOMER_ORDER_INCLUDE = {
  items: true,
  statusEvents: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, note: true, createdAt: true } },
  address: { select: { label: true, line1: true, line2: true, city: true, postalCode: true, latitude: true, longitude: true } },
  branch: { select: { id: true, name: true, latitude: true, longitude: true } },
  payments: { select: { id: true, method: true, status: true, amount: true, providerName: true, createdAt: true } },
  assignment: {
    select: {
      id: true,
      status: true,
      tipAmt: true,
      deliveryPhotoUrl: true,
      deliveredAt: true,
      rider: { select: { id: true, vehicleNumber: true, user: { select: { name: true, phone: true } } } }
    }
  }
} satisfies Prisma.OrderInclude;
