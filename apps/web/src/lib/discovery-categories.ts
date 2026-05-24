/**
 * Discovery taxonomy — the "What's on your mind?" food categories.
 *
 * Flavrly has NO global dish taxonomy: each restaurant defines its own per-branch
 * categories ("Biryani", "Pizza", …) and items ("Hyderabadi Chicken Biryani", …).
 * Rather than a DB migration + manual tagging, this curated config maps each
 * discovery tile to keyword matchers that are tested (case-insensitively) against
 * a menu item's name AND its category name. New restaurants auto-classify.
 *
 * This module is import-safe on both client and server (no server-only imports),
 * so the grid tiles and the category pages can share one source of truth.
 */

export type DiscoveryCategory = {
  /** URL slug → /category/<slug> */
  slug: string;
  /** Tile + page label, e.g. "Biryani" */
  label: string;
  /** Short marketing tagline shown on the category hero. */
  tagline: string;
  /** Curated hero/tile image (Unsplash; wrapped in ImageWithFallback so a dead
   *  URL degrades to a gradient placeholder). */
  image: string;
  /** Lower-cased substrings; an item matches if ANY appears in
   *  `${item.name} ${category.name}` (lower-cased). Order doesn't matter. */
  match: string[];
};

/** Build a sized Unsplash URL from a photo id. */
const img = (id: string, w = 500) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&auto=format&fit=crop&q=80`;

/**
 * The curated grid. Order = display order. Every tile always renders (with an
 * image); category pages handle "nothing nearby yet" gracefully.
 */
export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  {
    slug: 'biryani',
    label: 'Biryani',
    tagline: 'Where every grain carries flavour.',
    image: img('1633945274405-b6c8069047b0'),
    match: ['biryani', 'dum']
  },
  {
    slug: 'pizza',
    label: 'Pizza',
    tagline: 'Hand-tossed, loaded, baked to order.',
    image: img('1513104890138-7c749659a591'),
    match: ['pizza', 'margherita', 'pepperoni', 'formaggi']
  },
  {
    slug: 'rolls',
    label: 'Rolls',
    tagline: 'Maximum filling, every wrap.',
    image: img('1633896949673-1eb9d131a9b4'),
    match: ['roll', 'wrap', 'frankie', 'kathi', 'shawarma']
  },
  {
    slug: 'thali',
    label: 'Thali & Meals',
    tagline: 'A full plate, sorted.',
    image: img('1631452180519-c014fe946bc7'),
    match: ['thali', 'meal', 'combo', 'platter']
  },
  {
    slug: 'bowls',
    label: 'Bowls',
    tagline: 'Rice, gravy, goodness in a bowl.',
    image: img('1543339308-43e59d6b73a6'),
    match: ['bowl', 'rice bowl']
  },
  {
    slug: 'starters',
    label: 'Starters',
    tagline: 'Crispy, smoky, shareable bites.',
    image: img('1567188040759-fb8a883dc6d8'),
    match: ['starter', 'tikka', '65', 'kebab', 'wings', 'pakora', 'tandoori', 'fry']
  },
  {
    slug: 'curries',
    label: 'Curries',
    tagline: 'Rich gravies, deep spice.',
    image: img('1585937421612-70a008356fbe'),
    match: ['butter chicken', 'makhani', 'masala', 'curry', 'korma', 'gravy', 'main']
  },
  {
    slug: 'paneer',
    label: 'Paneer',
    tagline: 'Soft, fresh, full of protein.',
    image: img('1631452180519-c014fe946bc7'),
    match: ['paneer']
  },
  {
    slug: 'chicken',
    label: 'Chicken',
    tagline: 'From tikka to tandoori.',
    image: img('1626082927389-6cd097cdc6ec'),
    match: ['chicken']
  },
  {
    slug: 'pasta',
    label: 'Pasta',
    tagline: 'Al dente, every time.',
    image: img('1621996346565-e3dbc646d9a9'),
    match: ['pasta', 'spaghetti', 'penne', 'fettuccine', 'lasagna', 'alfredo', 'carbonara', 'arrabbiata', 'ravioli']
  },
  {
    slug: 'breads',
    label: 'Breads',
    tagline: 'Fresh from the tandoor.',
    image: img('1601050690597-df0568f70950'),
    match: ['naan', 'roti', 'kulcha', 'paratha', 'bread', 'phulka']
  },
  {
    slug: 'salads',
    label: 'Salads',
    tagline: 'Crisp, fresh, guilt-free.',
    image: img('1512621776951-a57141f2eefd'),
    match: ['salad', 'caprese', 'caesar']
  },
  {
    slug: 'desserts',
    label: 'Desserts',
    tagline: 'A sweet finish to every meal.',
    image: img('1551024601-bec78aea704b'),
    match: ['dessert', 'gulab', 'phirni', 'tiramisu', 'panna cotta', 'kulfi', 'ice cream', 'brownie', 'jamun', 'sweet', 'cake']
  },
  {
    slug: 'beverages',
    label: 'Beverages',
    tagline: 'Cool it down, sip it up.',
    image: img('1544145945-f90425340c7e'),
    match: ['lassi', 'chai', 'cola', 'coke', 'juice', 'beverage', 'shake', 'smoothie', 'mojito', 'water', 'tea', 'coffee']
  }
];

const BY_SLUG = new Map(DISCOVERY_CATEGORIES.map((c) => [c.slug, c]));

export function getDiscoveryCategory(slug: string): DiscoveryCategory | undefined {
  return BY_SLUG.get(slug);
}

/** Does this menu item belong to the given discovery category? */
export function itemMatchesCategory(
  category: DiscoveryCategory,
  itemName: string,
  categoryName: string | null | undefined
): boolean {
  const hay = `${itemName} ${categoryName ?? ''}`.toLowerCase();
  return category.match.some((m) => hay.includes(m));
}

/** Normalised key used to dedupe the same dish across restaurants for the tiles
 *  (e.g. strips trailing "(2 pc)", "(300ml)" qualifiers and collapses spaces). */
export function dishKey(itemName: string): string {
  return itemName
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // drop parentheticals
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
