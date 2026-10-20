/**
 * PATCH /api/admin/feedback/[id]
 *
 * Moderate or reply to a piece of in-app order feedback. Tenant-scoped: the
 * feedback's order must belong to a restaurant the caller manages (otherwise
 * 404, never leaking existence).
 *
 * Body: { action: 'hide' | 'unhide' | 'flag' | 'reply', reason?, reply? }
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import {
  moderationGate, statusData, refreshRiders, REPLY_MAX, FLAG_REASON_MAX, type StatusAction
} from '@/server/reviews/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await moderationGate(req.nextUrl?.searchParams?.get('restaurantId'));
  if (gate instanceof Response) return gate;
  const { userId, restaurant } = gate;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid body' }, { status: 400 });
  const action = (body as any).action as string;

  let data: Record<string, unknown>;
  let auditAction: 'feedback.moderate' | 'feedback.reply';
  if (action === 'hide' || action === 'unhide' || action === 'flag') {
    const reason = typeof (body as any).reason === 'string' ? (body as any).reason.trim() : '';
    if (action === 'flag' && (!reason || reason.length > FLAG_REASON_MAX)) {
      return Response.json({ error: `A flag reason (1-${FLAG_REASON_MAX} chars) is required` }, { status: 400 });
    }
    data = statusData(action as StatusAction, userId, reason);
    auditAction = 'feedback.moderate';
  } else if (action === 'reply') {
    const reply = typeof (body as any).reply === 'string' ? (body as any).reply.trim() : '';
    if (!reply || reply.length > REPLY_MAX) {
      return Response.json({ error: `Reply must be 1-${REPLY_MAX} characters` }, { status: 400 });
    }
    data = { reply, replyAt: new Date(), replyByUserId: userId };
    auditAction = 'feedback.reply';
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  const existing = await (prisma as any).orderFeedback.findFirst({
    where: { id, order: { branch: { restaurantId: restaurant.id } } },
    include: { order: { select: { assignment: { select: { riderId: true } } } } }
  });
  if (!existing) return new Response('Not found', { status: 404 });

  const updated = await (prisma as any).orderFeedback.update({ where: { id }, data });

  await audit(auditAction, {
    actorId: userId,
    actorRole: 'ADMIN',
    restaurantId: restaurant.id,
    entityType: 'OrderFeedback',
    entityId: id,
    before: { moderationStatus: existing.moderationStatus, flagReason: existing.flagReason, reply: existing.reply },
    after: { action, moderationStatus: updated.moderationStatus, flagReason: updated.flagReason, reply: updated.reply }
  });

  if (auditAction === 'feedback.moderate') await refreshRiders([existing.order?.assignment?.riderId]);

  return Response.json({
    ok: true,
    feedback: {
      id,
      moderationStatus: updated.moderationStatus,
      flagReason: updated.flagReason ?? null,
      reply: updated.reply ?? null,
      replyAt: updated.replyAt ?? null
    }
  });
}
