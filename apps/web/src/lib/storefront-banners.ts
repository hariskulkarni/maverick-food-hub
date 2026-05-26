/**
 * Per-restaurant storefront hero banners.
 *
 * When a restaurant slug has entries here AND the files exist on disk, its
 * `/r/<slug>` page renders a full-bleed image carousel in place of the single
 * cover-image hero. Image paths are served from `apps/web/public`
 * (e.g. `/banners/foo-1.jpg`).
 *
 * This is a lightweight, no-migration mechanism: add a slug → image-list entry
 * and drop the files in public/banners/. (A future admin-managed version could
 * move these to the DB; the carousel component is agnostic to the source.)
 *
 * `bannersForSlug` filters the configured list down to files that actually
 * exist in public/ — a server-side fs check. This means a configured-but-not-
 * yet-uploaded banner does NOT get handed to next/image (whose optimizer would
 * otherwise log "isn't a valid image … received null" on every visit). If none
 * of a slug's files are present, the page cleanly falls back to the cover hero;
 * the carousel lights up automatically the moment the real files land.
 */
import { existsSync } from 'fs';
import { join } from 'path';

export const STOREFRONT_BANNERS: Record<string, string[]> = {
  'bowl-and-barbeque': ['/banners/bowl-and-barbeque-1.jpg', '/banners/bowl-and-barbeque-2.jpg']
};

/** True if a `/public`-relative path (e.g. "/banners/x.jpg") exists on disk. */
function publicFileExists(publicPath: string): boolean {
  try {
    return existsSync(join(process.cwd(), 'public', publicPath.replace(/^\/+/, '')));
  } catch {
    return false;
  }
}

export function bannersForSlug(slug: string): string[] | null {
  const list = STOREFRONT_BANNERS[slug];
  if (!list || list.length === 0) return null;
  const present = list.filter(publicFileExists);
  return present.length > 0 ? present : null;
}
