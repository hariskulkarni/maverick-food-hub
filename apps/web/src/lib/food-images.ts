/**
 * Curated Unsplash food photos, hand-picked for relevance.
 * URLs verified against Unsplash search results.
 *
 * The query string `?w=N&auto=format&fit=crop&q=80` lets Unsplash serve
 * a properly-sized, optimized image (and stops next/image from complaining).
 */

const u = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&auto=format&fit=crop&q=80`;

const uPremium = (id: string, w = 800) =>
  `https://plus.unsplash.com/premium_photo-${id}?w=${w}&auto=format&fit=crop&q=80`;

/** Map menu-item slug → image URL. Falls back to FOOD_FALLBACK if missing. */
export const FOOD_IMAGES: Record<string, string> = {
  // Biryani
  'hyderabadi-chicken-biryani': u('1633945274405-b6c8069047b0'),
  'lucknowi-mutton-biryani':    u('1631515243349-e0cb75fb8d3a'),
  'paneer-tikka-biryani':       u('1599043513900-ed6fe01d3833'),
  'veg-dum-biryani':            u('1697155406055-2db32d47ca07'),

  // Starters
  'chicken-65':                 u('1614398750956-402891a7dce1'),
  'paneer-tikka':               u('1614398751058-eb2e0bf63e53'),
  'gobi-65':                    u('1714799263303-29e7d638578a'),

  // Mains
  'butter-chicken':             u('1603894584373-5ac82b2ae398'),
  'dal-makhani':                u('1707448829764-9474458021ed'),
  'paneer-butter-masala':       u('1610057099443-fde8c4d50f91'),

  // Breads (real curry-with-naan shots; the bread is the hero)
  'butter-naan':                u('1772730065344-4cf131b39951'),
  'garlic-naan':                u('1772730064970-a7b2735c93b9'),

  // Desserts (warm, plated indian-food adjacent)
  'gulab-jamun':                u('1705174427925-744646e72117'),
  'phirni':                     u('1728745118618-941ec839208f'),

  // Beverages
  'masala-chai':                u('1505253758473-96b7015fcd40'),
  'sweet-lassi':                u('1589302168068-964664d93dc0'),
  'cola':                       u('1734770931927-6410f9a64832')
};

/** Map combo slug → image URL */
export const COMBO_IMAGES: Record<string, string> = {
  'biryani-feast': u('1694643666478-87660ba357a4')
};

/** Map category slug → image URL (used for category headers / banners) */
export const CATEGORY_IMAGES: Record<string, string> = {
  biryani:    u('1563379091339-03b21ab4a4f8'),
  starters:   u('1614398751058-eb2e0bf63e53'),
  mains:      u('1772730065344-4cf131b39951'),
  breads:     u('1772730064970-a7b2735c93b9'),
  desserts:   u('1728745118618-941ec839208f'),
  beverages:  u('1505253758473-96b7015fcd40')
};

/** Hero / banner image for the homepage */
export const HERO_IMAGE = u('1633945274405-b6c8069047b0', 1600);

/** Generic fallback when an item has no specific image */
export const FOOD_FALLBACK = u('1734770931927-6410f9a64832');

/** Lookup helper used by components */
export function imageFor(slug?: string | null, fallback = FOOD_FALLBACK): string {
  if (!slug) return fallback;
  return FOOD_IMAGES[slug] ?? COMBO_IMAGES[slug] ?? CATEGORY_IMAGES[slug] ?? fallback;
}
