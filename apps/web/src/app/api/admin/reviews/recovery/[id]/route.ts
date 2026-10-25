/**
 * PATCH /api/admin/reviews/recovery/<id> — update status, notes, assignee or the
 * goodwill note of a service-recovery ticket. Goodwill gestures are
 * unconditional and must never be tied to a review. Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { tenantAdminOrError } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';
import { restaurantStaff, updateTicket } from '@/server/reviews/recovery-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (max: number) => z.string().max(max).transform((v) => v.trim() || null).nullable().optional();

const Body = z.object({
  status: z.enum(['OPEN', 'CONTACTED', 'RESOLVED']).optional(),
  notes: text(2000),
  assigneeUserId: z.string().max(64).nullable().optional(),
  goodwillNote: text(500),
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const { id } = await params;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    if (parsed.assigneeUserId) {
      const staff = await restaurantStaff(restaurant.id);
      if (!staff.some((s) => s.id === parsed.assigneeUserId)) {
        return Response.json({ error: 'Assignee must be a member of this restaurant' }, { status: 400 });
      }
    }
    const r = await updateTicket(restaurant.id, id, parsed);
    if (!r) return Response.json({ error: 'Not found' }, { status: 404 });
    const session = await auth();
    await audit('reviews.recovery.update', {
      actorId: session?.user?.id ?? null,
      actorRole: session?.user?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'ServiceRecoveryTicket',
      entityId: id,
      before: { status: r.before.status, assigneeUserId: r.before.assigneeUserId, hasGoodwill: !!r.before.goodwillNote },
      after: { status: r.after.status, assigneeUserId: r.after.assigneeUserId, hasGoodwill: !!r.after.goodwillNote },
    });
    return Response.json({
      ok: true,
      ticket: {
        id: r.after.id, status: r.after.status, notes: r.after.notes, assigneeUserId: r.after.assigneeUserId,
        goodwillNote: r.after.goodwillNote, goodwillAt: r.after.goodwillAt, contactedAt: r.after.contactedAt, resolvedAt: r.after.resolvedAt,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
