import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { publish } from '@/server/realtime';
import { unauthenticated, forbidden } from '@/server/api-auth';
import { AssignmentStatus, Role } from '@prisma/client';

const Body = z.object({ riderId: z.string(), reason: z.string().max(500).optional() });

/**
 * Reassign an in-flight order from its current rider to a new one.
 *
 * Auth: SUPER_ADMIN may reassign any order; ADMIN may only reassign orders
 * for branches inside their own restaurant.
 *
 * Side effects:
 *   - cancels the existing RiderAssignment (if any) and decrements its load
 *   - creates a fresh PENDING assignment on the new rider via assignRider()
 *   - publishes a `reassigned` event on `order:{id}` so listeners refresh
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const role = session.user.role;
  if (role !== Role.SUPER_ADMIN && role !== Role.ADMIN) {
    return forbidden('Only ops admins can reassign orders.');
  }

  const body = Body.parse(await req.json());

  const order = await prisma.order.findUnique({
    where: { id },
    include: { branch: { select: { restaurantId: true } }, assignment: true }
  });
  if (!order) {
    return Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 });
  }

  // Tenancy: restaurant admin must belong to the order's restaurant.
  if (role === Role.ADMIN) {
    const membership = await prisma.restaurantUser.findFirst({
      where: { userId: session.user.id, restaurantId: order.branch.restaurantId }
    });
    if (!membership) {
      return forbidden('That order belongs to a different restaurant.');
    }
  }

  // Bail if the order is already delivered/cancelled — nothing to reassign.
  const TERMINAL = new Set([
    'DELIVERED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT',
    'CANCELLED_BY_ADMIN', 'REFUND_PENDING', 'REFUND_INITIATED', 'REFUNDED',
    'DELIVERY_FAILED', 'PAYMENT_FAILED'
  ]);
  if (TERMINAL.has(order.status)) {
    return Response.json(
      { error: 'This order is already finished or cancelled — nothing to reassign.', reason: 'terminal_state' },
      { status: 409 }
    );
  }

  if (order.assignment && order.assignment.riderId === body.riderId) {
    return Response.json(
      { error: 'That rider already has this order.', reason: 'already_assigned' },
      { status: 409 }
    );
  }

  // Sanity-check the target rider — must exist and be online.
  const target = await prisma.riderProfile.findUnique({ where: { id: body.riderId } });
  if (!target) {
    return Response.json({ error: 'Rider not found.', reason: 'rider_not_found' }, { status: 404 });
  }
  if (!target.isOnline) {
    return Response.json(
      { error: 'That rider is offline — pick another or wait until they come online.', reason: 'rider_offline' },
      { status: 409 }
    );
  }

  // Bypass the rider-allocator's status guard (which only allows ACCEPTED/
  // PREPARING/READY) — we want to be able to reassign mid-flight as well.
  // Single transaction: free up the old rider, hand the row to the new one.
  const prevRiderId = order.assignment?.riderId ?? null;
  const reassignActive =
    order.assignment &&
    (order.assignment.status === AssignmentStatus.PENDING ||
      order.assignment.status === AssignmentStatus.ACCEPTED ||
      order.assignment.status === AssignmentStatus.PICKED_UP);

  const a = await prisma.$transaction(async (tx) => {
    if (reassignActive && prevRiderId) {
      await tx.riderProfile.update({
        where: { id: prevRiderId },
        data: { currentLoad: { decrement: 1 } }
      });
    }
    const assn = await tx.riderAssignment.upsert({
      where: { orderId: id },
      update: {
        riderId: body.riderId,
        status: AssignmentStatus.PENDING,
        assignedAt: new Date(),
        acceptedAt: null,
        pickedUpAt: null,
        notes: body.reason ?? 'Reassigned by ops'
      },
      create: { orderId: id, riderId: body.riderId, status: AssignmentStatus.PENDING }
    });
    await tx.riderProfile.update({
      where: { id: body.riderId },
      data: { currentLoad: { increment: 1 } }
    });
    return assn;
  });

  if (prevRiderId) {
    // No first-class "unassigned" event; emit a synthetic status so the old
    // rider's app refreshes its assignment list.
    publish(`rider:${prevRiderId}`, { kind: 'status', orderId: id, status: 'REASSIGNED_AWAY', at: new Date().toISOString() });
  }
  publish(`rider:${body.riderId}`, { kind: 'assigned', orderId: id, riderId: body.riderId });
  publish(`order:${id}`, { kind: 'assigned', orderId: id, riderId: body.riderId });
  return Response.json(a);
}
