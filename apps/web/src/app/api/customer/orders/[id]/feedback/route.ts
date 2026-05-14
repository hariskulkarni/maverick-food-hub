/**
 * Customer post-delivery feedback for a single order.
 *
 *   GET    → { feedback, eligibility, windowEndsAt }
 *   POST   → create new feedback (calls canSubmitFeedback gate)
 *   PATCH  → edit existing feedback (calls canEditFeedback gate; sets editedAt)
 *
 * All three require the signed-in customer to be the order's customer.
 * The 48h window math lives in `@/server/feedback`. POST snapshots
 * `windowEndsAt = deliveredAt + FEEDBACK_WINDOW_MS` at create time so
 * later changes to deliveredAt can't extend (or shrink) the window.
 *
 * Audit + storage failures NEVER roll back the mutation.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import {
  canSubmitFeedback,
  canEditFeedback,
  findFeedbackByOrder,
  FEEDBACK_WINDOW_MS,
  type OrderLite
} from '@/server/feedback';

export const dynamic = 'force-dynamic';

// ── Body schema ──────────────────────────────────────────────────────────

const ISSUE_TAGS = [
  'LATE_DELIVERY',
  'MISSING_ITEM',
  'WRONG_ITEM',
  'COLD_FOOD',
  'PACKAGING_ISSUE',
  'RIDER_BEHAVIOR',
  'FOOD_QUALITY'
] as const;

const Body = z.object({
  foodRating: z.number().int().min(1).max(5).optional(),
  deliveryRating: z.number().int().min(1).max(5).optional(),
  overallRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
  issueTags: z.array(z.enum(ISSUE_TAGS)).max(7).optional(),
  imageUrl: z.string().optional(),
  shareCommentWithRider: z.boolean().optional()
}).refine(
  (d) =>
    d.foodRating != null ||
    d.deliveryRating != null ||
    d.overallRating != null ||
    (d.issueTags && d.issueTags.length > 0),
  { message: 'At least one rating or one issue tag is required.' }
);

// ── Helpers ──────────────────────────────────────────────────────────────

async function loadOrderLite(orderId: string): Promise<(OrderLite & { code: string }) | null> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      customerId: true,
      status: true,
      deliveredAt: true,
      updatedAt: true,
      assignment: { select: { deliveredAt: true } }
    }
  });
  if (!o) return null;
  // Prefer assignment.deliveredAt → order.deliveredAt → updatedAt (when DELIVERED).
  const delivered: Date | null =
    o.assignment?.deliveredAt ?? o.deliveredAt ?? (o.status === 'DELIVERED' ? o.updatedAt : null);
  return {
    id: o.id,
    code: o.code,
    customerId: o.customerId,
    status: o.status as string,
    deliveredAt: delivered
  };
}

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const order = await loadOrderLite(id);
  if (!order) return new Response('Not found', { status: 404 });
  if (order.customerId !== session.user.id) return new Response('Forbidden', { status: 403 });

  const feedback = await findFeedbackByOrder(id);
  const eligibility = feedback
    ? canEditFeedback(feedback, session.user.id)
    : canSubmitFeedback(order, null, session.user.id);
  const windowEndsAt = feedback
    ? new Date(feedback.windowEndsAt)
    : order.deliveredAt
    ? new Date(order.deliveredAt.getTime() + FEEDBACK_WINDOW_MS)
    : null;

  return Response.json({ feedback, eligibility, windowEndsAt });
}

// ── POST (create) ────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid', issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const order = await loadOrderLite(id);
  if (!order) return new Response('Not found', { status: 404 });

  const existing = await findFeedbackByOrder(id);
  const elig = canSubmitFeedback(order, existing, session.user.id);
  if (!elig.eligible) {
    return Response.json({ error: 'not_eligible', reason: elig.reason }, { status: 409 });
  }

  // Window snapshot — order.deliveredAt is guaranteed non-null by canSubmit.
  const deliveredAt = order.deliveredAt!;
  const windowEndsAt = new Date(deliveredAt.getTime() + FEEDBACK_WINDOW_MS);

  const created = await (prisma as any).orderFeedback.create({
    data: {
      orderId: id,
      customerId: session.user.id,
      foodRating: data.foodRating ?? null,
      deliveryRating: data.deliveryRating ?? null,
      overallRating: data.overallRating ?? null,
      comment: data.comment ?? null,
      issueTags: data.issueTags ?? [],
      imageUrl: data.imageUrl ?? null,
      shareCommentWithRider: data.shareCommentWithRider ?? false,
      windowEndsAt
    }
  });

  // Post-commit audit — failures must NOT bubble up.
  audit('order.feedback.submitted', {
    actorId: session.user.id,
    actorRole: 'CUSTOMER',
    entityType: 'OrderFeedback',
    entityId: created.id,
    before: null,
    after: {
      orderId: id,
      orderCode: order.code,
      foodRating: created.foodRating,
      deliveryRating: created.deliveryRating,
      overallRating: created.overallRating,
      issueTags: created.issueTags,
      hasComment: !!created.comment,
      hasImage: !!created.imageUrl,
      shareCommentWithRider: created.shareCommentWithRider
    }
  }).catch((e) => log.error({ err: e }, 'feedback submit audit failed'));

  return Response.json({ feedback: created }, { status: 201 });
}

// ── PATCH (edit) ─────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid', issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await findFeedbackByOrder(id);
  const elig = canEditFeedback(existing, session.user.id);
  if (!elig.eligible) {
    return Response.json({ error: 'not_eligible', reason: elig.reason }, { status: 409 });
  }

  const before = {
    foodRating: existing!.foodRating,
    deliveryRating: existing!.deliveryRating,
    overallRating: existing!.overallRating,
    comment: existing!.comment,
    issueTags: existing!.issueTags,
    imageUrl: existing!.imageUrl,
    shareCommentWithRider: existing!.shareCommentWithRider
  };

  const updated = await (prisma as any).orderFeedback.update({
    where: { orderId: id },
    data: {
      foodRating: data.foodRating ?? null,
      deliveryRating: data.deliveryRating ?? null,
      overallRating: data.overallRating ?? null,
      comment: data.comment ?? null,
      issueTags: data.issueTags ?? [],
      imageUrl: data.imageUrl ?? null,
      shareCommentWithRider: data.shareCommentWithRider ?? false,
      editedAt: new Date()
    }
  });

  audit('order.feedback.edited', {
    actorId: session.user.id,
    actorRole: 'CUSTOMER',
    entityType: 'OrderFeedback',
    entityId: updated.id,
    before,
    after: {
      foodRating: updated.foodRating,
      deliveryRating: updated.deliveryRating,
      overallRating: updated.overallRating,
      comment: updated.comment,
      issueTags: updated.issueTags,
      imageUrl: updated.imageUrl,
      shareCommentWithRider: updated.shareCommentWithRider
    }
  }).catch((e) => log.error({ err: e }, 'feedback edit audit failed'));

  return Response.json({ feedback: updated });
}
