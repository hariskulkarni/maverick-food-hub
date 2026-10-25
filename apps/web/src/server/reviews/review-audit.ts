/**
 * audit() wrapper for Google-review admin actions: resolves the acting user
 * from the session and records entityType GoogleReview / ReviewSettings.
 * Never throws (audit() itself is best-effort).
 */
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export type ReviewAuditAction =
  | 'reviews.config.update' | 'reviews.publish.update' | 'reviews.settings.update' | 'reviews.sync'
  | 'reviews.reply.generate' | 'reviews.reply.approve' | 'reviews.reply.post' | 'reviews.reply.draft'
  | 'reviews.location.select' | 'reviews.template.create' | 'reviews.template.update' | 'reviews.template.delete'
  | 'reviews.digest.test' | 'reviews.voice.refresh' | 'reviews.match.refresh';

export async function auditReview(
  action: ReviewAuditAction,
  restaurantId: string,
  opts: { entityId?: string | null; entityType?: string; before?: unknown; after?: unknown } = {},
): Promise<void> {
  const session = await auth().catch(() => null);
  await audit(action, {
    actorId: session?.user?.id ?? null,
    actorRole: (session?.user as { role?: string } | undefined)?.role ?? null,
    restaurantId,
    entityType: opts.entityType ?? (opts.entityId ? 'GoogleReview' : 'ReviewSettings'),
    entityId: opts.entityId ?? null,
    before: opts.before,
    after: opts.after,
  });
}
