/**
 * Per-restaurant storefront hero banners.
 *
 * When a restaurant slug has entries here, its `/r/<slug>` page renders a
 * full-bleed image carousel in place of the single cover-image hero. Image
 * paths are served from `apps/web/public` (e.g. `/banners/foo-1.jpg`), so a
 * missing file degrades gracefully via <ImageWithFallback>.
 *
 * This is a lightweight, no-migration mechanism: add a slug → image-list entry
 * and drop the files in public/banners/. (A future admin-managed version could
 * move these to the DB; the carousel component is agnostic to the source.)
 */
export const STOREFRONT_BANNERS: Record<string, string[]> = {
  'bowl-and-barbeque': ['/banners/bowl-and-barbeque-1.jpg', '/banners/bowl-and-barbeque-2.jpg']
};

export function bannersForSlug(slug: string): string[] | null {
  const list = STOREFRONT_BANNERS[slug];
  return list && list.length > 0 ? list : null;
}
