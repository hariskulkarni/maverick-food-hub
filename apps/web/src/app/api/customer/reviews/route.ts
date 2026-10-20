/**
 * GET /api/customer/reviews
 * The signed-in customer's own OrderFeedback (full own data via the CUSTOMER
 * projection) plus any restaurant reply and an edit flag. Editing goes through
 * the existing PATCH /api/customer/orders/[id]/feedback (48h window gate).
 * Moderation status / flag reason are deliberately not exposed.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { canEditFeedback, visibleForRole, type FeedbackLite } from '@/server/feedback';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 });
  const userId = session.user.id;

  const rows = await (prisma as any).orderFeedback.findMany({
    where: { customerId: userId },
    include: { order: { select: { code: true, branch: { select: { restaurant: { select: { name: true, slug: true } } } } } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const now = new Date();
  const reviews = rows.map((r: any) => ({
    ...visibleForRole(r as FeedbackLite, 'CUSTOMER'),
    shareCommentWithRider: !!r.shareCommentWithRider,
    sharePublicly: !!r.sharePublicly,
    windowEndsAt: new Date(r.windowEndsAt).toISOString(),
    canEdit: canEditFeedback(r as FeedbackLite, userId, now).eligible,
    reply: r.reply ? { text: r.reply, at: r.replyAt ? new Date(r.replyAt).toISOString() : null } : null,
    orderCode: r.order?.code ?? null,
    restaurant: r.order?.branch?.restaurant ?? null,
  }));
  return Response.json({ reviews });
}
