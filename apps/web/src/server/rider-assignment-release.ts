import { AssignmentStatus, OrderStatus, type Prisma } from '@prisma/client';

/** Order statuses that end the delivery without a hand-over. */
export const DELIVERY_CLOSED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
];

const ACTIVE: readonly AssignmentStatus[] = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP];

/**
 * When support fails or cancels an order, close the rider's still-active
 * assignment and give back the load slot taken at assignment time, so the
 * rider is free for new orders. Returns the released rider id, if any.
 */
export async function releaseAssignmentOnOrderClose(
  tx: Prisma.TransactionClient,
  orderId: string,
  next: OrderStatus,
): Promise<string | null> {
  if (!DELIVERY_CLOSED_STATUSES.includes(next)) return null;
  const a = await tx.riderAssignment.findUnique({ where: { orderId } });
  if (!a || !ACTIVE.includes(a.status)) return null;
  const closed = await tx.riderAssignment.updateMany({
    where: { id: a.id, status: a.status },
    data: { status: AssignmentStatus.CANCELLED },
  });
  if (closed.count === 0) return null;
  await tx.riderProfile.updateMany({
    where: { id: a.riderId, currentLoad: { gt: 0 } },
    data: { currentLoad: { decrement: 1 } },
  });
  return a.riderId;
}
