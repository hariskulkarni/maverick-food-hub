/**
 * Pure rating-gate for Google-review auto-reply. No I/O.
 *   rating >= autoPostMinRating  → AUTO_POST
 *   rating <= draftMaxRating     → DRAFT (held for admin approval)
 *   otherwise / disabled / no cfg → SKIP
 */
export type ReplyDecision = 'AUTO_POST' | 'DRAFT' | 'SKIP';

export function decideReplyAction(
  rating: number,
  cfg: { enabled: boolean; autoPostMinRating: number; draftMaxRating: number } | null,
): ReplyDecision {
  if (!cfg || !cfg.enabled) return 'SKIP';
  if (rating >= cfg.autoPostMinRating) return 'AUTO_POST';
  if (rating <= cfg.draftMaxRating) return 'DRAFT';
  return 'SKIP';
}
