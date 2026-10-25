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

/**
 * First configured sensitive keyword the review mentions (case-insensitive,
 * whole-word/phrase), or null. Such reviews are never auto-posted: they are
 * held for the owner's approval instead.
 */
export function findSensitiveKeyword(comment: string | null, keywords: string[] | null | undefined): string | null {
  const text = (comment ?? '').toLowerCase();
  if (!text || !keywords?.length) return null;
  for (const raw of keywords) {
    const k = raw.trim().toLowerCase();
    if (!k) continue;
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${escaped}`, 'i');
    if (re.test(text)) return raw.trim();
  }
  return null;
}
