/** Shared helpers for admin feedback moderation (single + bulk). */
import { requireTenantAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { forbidden, unauthenticated } from '@/server/api-auth';
import { recomputeRiderRating } from './rider-rating';

export const REPLY_MAX = 1000;
export const FLAG_REASON_MAX = 500;

export type StatusAction = 'hide' | 'unhide' | 'flag';

export const STATUS_FOR: Record<StatusAction, 'HIDDEN' | 'PUBLISHED' | 'FLAGGED'> = {
  hide: 'HIDDEN',
  unhide: 'PUBLISHED',
  flag: 'FLAGGED'
};

/** Resolve the acting restaurant admin + managed restaurant, or a Response. */
export async function moderationGate(restaurantId?: string | null) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const role = (session.user as any).role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return forbidden('Only a restaurant admin can do that.');
  try {
    // Membership-aware: a global ADMIN holding only a KITCHEN grant here is refused.
    const restaurant = await requireTenantAdmin(restaurantId);
    return { userId: session.user.id as string, restaurant };
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export function statusData(action: StatusAction, userId: string, reason?: string) {
  return {
    moderationStatus: STATUS_FOR[action],
    flagReason: action === 'flag' ? (reason ?? null) : null,
    moderatedByUserId: userId,
    moderatedAt: new Date()
  };
}

/** Rider averages only count PUBLISHED feedback, so refresh after a status change. */
export async function refreshRiders(riderIds: (string | null | undefined)[]) {
  const ids = [...new Set(riderIds.filter((x): x is string => !!x))];
  await Promise.all(ids.map((id) => recomputeRiderRating(id)));
}

/** Moderation fields appended to the (role-redacted) admin projection. */
export function moderationFields(r: any) {
  return {
    moderationStatus: (r.moderationStatus ?? 'PUBLISHED') as 'PUBLISHED' | 'HIDDEN' | 'FLAGGED',
    flagReason: r.flagReason ?? null,
    reply: r.reply ?? null,
    replyAt: r.replyAt ?? null
  };
}
