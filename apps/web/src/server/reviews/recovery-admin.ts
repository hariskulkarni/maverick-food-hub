/**
 * Admin read/write for service-recovery tickets. Every query is scoped by the
 * caller's managed restaurantId (tenancy is enforced by the route).
 */
import type { RecoveryTicketStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { minutesLate } from './recovery';

export async function restaurantStaff(restaurantId: string): Promise<{ id: string; name: string }[]> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      owner: { select: { id: true, name: true, email: true } },
      members: { select: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!r) return [];
  const all = [r.owner, ...r.members.map((m) => m.user)];
  const seen = new Set<string>();
  return all
    .filter((u) => u && !seen.has(u.id) && seen.add(u.id))
    .map((u) => ({ id: u.id, name: u.name || u.email || 'Staff' }));
}

export async function listTickets(restaurantId: string, status?: RecoveryTicketStatus) {
  const rows = await prisma.serviceRecoveryTicket.findMany({
    where: { restaurantId, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
    include: {
      order: {
        select: {
          id: true, code: true, fulfillmentType: true, placedAt: true, readyAt: true, deliveredAt: true,
          estimatedDeliveryAt: true, total: true,
          customer: { select: { name: true, phone: true } },
          items: { select: { name: true, quantity: true } },
          assignment: { select: { deliveredAt: true, rider: { select: { user: { select: { name: true } } } } } },
          feedback: { select: { issueTags: true, foodRating: true, deliveryRating: true, overallRating: true } },
        },
      },
    },
  });
  return rows.map((t) => {
    const o = t.order;
    const deliveredAt = o?.assignment?.deliveredAt ?? o?.deliveredAt ?? null;
    return {
      id: t.id,
      status: t.status,
      rating: t.rating,
      comment: t.comment,
      notes: t.notes,
      goodwillNote: t.goodwillNote,
      goodwillAt: t.goodwillAt,
      assigneeUserId: t.assigneeUserId,
      contactedAt: t.contactedAt,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt,
      source: o ? 'order' : 'qr',
      customer: { name: o?.customer?.name ?? t.contactName ?? null, phone: o?.customer?.phone ?? t.contactPhone ?? null },
      order: o
        ? {
            id: o.id,
            code: o.code,
            fulfillmentType: o.fulfillmentType,
            total: Number(o.total),
            placedAt: o.placedAt,
            readyAt: o.readyAt,
            deliveredAt,
            estimatedDeliveryAt: o.estimatedDeliveryAt,
            minutesLate: minutesLate({ estimatedDeliveryAt: o.estimatedDeliveryAt, deliveredAt }),
            riderName: o.assignment?.rider?.user?.name ?? null,
            items: o.items,
            issueTags: o.feedback?.issueTags ?? [],
            ratings: o.feedback
              ? { food: o.feedback.foodRating, delivery: o.feedback.deliveryRating, overall: o.feedback.overallRating }
              : null,
          }
        : null,
    };
  });
}

export type TicketPatch = {
  status?: RecoveryTicketStatus;
  notes?: string | null;
  assigneeUserId?: string | null;
  goodwillNote?: string | null;
};

/** Apply a patch to a ticket of this restaurant; null when the ticket is not theirs. */
export async function updateTicket(restaurantId: string, id: string, patch: TicketPatch, now: Date = new Date()) {
  const t = await prisma.serviceRecoveryTicket.findFirst({ where: { id, restaurantId } });
  if (!t) return null;
  const data: Record<string, unknown> = {};
  if (patch.status && patch.status !== t.status) {
    data.status = patch.status;
    if (patch.status === 'CONTACTED' && !t.contactedAt) data.contactedAt = now;
    if (patch.status === 'RESOLVED') data.resolvedAt = now;
    if (patch.status !== 'RESOLVED') data.resolvedAt = null;
  }
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.assigneeUserId !== undefined) data.assigneeUserId = patch.assigneeUserId;
  if (patch.goodwillNote !== undefined) {
    data.goodwillNote = patch.goodwillNote;
    data.goodwillAt = patch.goodwillNote ? now : null;
  }
  const updated = await prisma.serviceRecoveryTicket.update({ where: { id }, data });
  return { before: t, after: updated };
}
