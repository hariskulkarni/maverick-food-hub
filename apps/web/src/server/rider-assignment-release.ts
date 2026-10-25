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
  // The order will never be handed over, so there is no cash to collect.
  await tx.codCollection.updateMany({
    where: { orderId, status: 'PENDING_COLLECTION' },
    data: { status: 'WAIVED', notes: `Order closed (${next}) before hand-over — no cash collected.` },
  });
  return a.riderId;
}

/**
 * P2-21: the rider can't do a pickup they accepted (vehicle issue, emergency,
 * restaurant problem). Before pickup the ORDER is fine — only the rider leg
 * failed — so we remove the assignment, free the load slot and leave the order
 * READY for the pool. Single-winner on the assignment status. Returns false if
 * the assignment was no longer ACCEPTED/PENDING.
 */
export async function releaseAssignmentBeforePickup(
  tx: Prisma.TransactionClient,
  assignmentId: string,
): Promise<boolean> {
  const a = await tx.riderAssignment.findUnique({ where: { id: assignmentId } });
  if (!a || (a.status !== AssignmentStatus.ACCEPTED && a.status !== AssignmentStatus.PENDING)) return false;
  // RiderAssignment.orderId is unique and the pool lists only orders with no
  // assignment, so the row is removed (single winner on its status) rather
  // than kept as CANCELLED; the caller writes the audit trail.
  const removed = await tx.riderAssignment.deleteMany({ where: { id: a.id, status: a.status } });
  if (removed.count === 0) return false;
  await tx.riderProfile.updateMany({
    where: { id: a.riderId, currentLoad: { gt: 0 } },
    data: { currentLoad: { decrement: 1 } },
  });
  return true;
}
