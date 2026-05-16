/**
 * POST /api/rider/batch-invitations/[id]/decline
 *
 * The rider tapped DECLINE (or the client's countdown silently expired the
 * modal). Body may carry an optional `reason` string — free-text, capped to
 * keep it sane. Idempotent: declining an already-resolved invitation is a
 * no-op success so the client never has to special-case a late tap.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { BatchInvitationStatus } from '@prisma/client';
import { log } from '@/server/log';
import { requireRider } from '../../_helpers';

const MAX_REASON_LEN = 200;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRider();
  if (!guard.ok) return guard.response;

  // Optional reason from body. Tolerate empty / malformed bodies — a silent
  // auto-decline from the countdown timer sends no body at all.
  let reason: string | undefined;
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body?.reason === 'string') {
      const trimmed = body.reason.trim();
      if (trimmed) reason = trimmed.slice(0, MAX_REASON_LEN);
    }
  } catch {
    // No body / non-JSON body — fine, just means no reason.
  }

  const inv = await prisma.batchInvitation.findUnique({ where: { id } });
  if (!inv || inv.riderId !== guard.rider.profileId) {
    return new Response('Not found', { status: 404 });
  }

  // Idempotent — if already resolved (expired by sweeper, cancelled by sibling
  // accept, etc.) return the current state rather than 409, so a late client
  // tap doesn't surface as an error toast.
  if (inv.status !== BatchInvitationStatus.PENDING) {
    return Response.json({ ok: true, status: inv.status, noop: true });
  }

  try {
    const updated = await prisma.batchInvitation.update({
      where: { id },
      data: {
        status: BatchInvitationStatus.DECLINED,
        respondedAt: new Date(),
        reason,
      },
    });
    return Response.json({ ok: true, status: updated.status });
  } catch (e) {
    log.error({ err: e, invitationId: id }, 'batch decline failed');
    return new Response('Could not decline the batch', { status: 500 });
  }
}
