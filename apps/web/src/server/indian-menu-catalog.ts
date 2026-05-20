/**
 * Curated reference catalog of common Indian-restaurant menu items.
 *
 * Compiled from general culinary knowledge — NOT scraped from any specific
 * restaurant's copyrighted menu. Powers three things:
 *   1. The pre-filled "starter template" an admin can download, edit + import.
 *   2. Variant-value SUGGESTIONS in the item editor (typing "Paneer Butter
 *      Masala" suggests Half/Full; "Lassi" suggests Regular/Large).
 *   3. Sensible default base prices so a fresh menu isn't all ₹0.
 *
 * Prices are indicative ₹ (INR) mid-market values — admins edit to taste.
 * `variantSuggestions` are typical size splits; empty = usually single-size.
 */

export interface CatalogItem {
  category: string;
  name: string;
  description?: string;
  isVeg: boolean;
  /** Indicative base price in ₹. For variant items, the price of the smallest. */
  basePrice: number;
  /** Typical mutually-exclusive size variants (label → multiplier of basePrice). */
  variantSuggestions?: { name: string; price: number }[];
}

/**
 * Variant-name suggestions by loose dish-type keyword. The variant editor can
 * match an item name against these to propose size rows.
 */
export const VARIANT_SUGGESTIONS_BY_KEYWORD: Record<string, string[]> = {
  biryani: ['Half', 'Full'],
  curry: ['Half', 'Full'],
  masala: ['Half', 'Full'],
  gravy: ['Half', 'Full'],
  dal: ['Half', 'Full'],
  rice: ['Regular', 'Large'],
  noodles: ['Half', 'Full'],
  fried_rice: ['Half', 'Full'],
  lassi: ['Regular', 'Large'],
  juice: ['Regular', 'Large'],
  shake: ['Regular', 'Large'],
  tea: ['Small', 'Regular'],
  coffee: ['Small', 'Regular'],
  pizza: ['Small', 'Medium', 'Large'],
  thali: ['Mini', 'Regular', 'Deluxe'],
};

/** Common add-on modifier groups admins frequently want, as starting points. */
export const MODIFIER_GROUP_SUGGESTIONS: { name: string; minSelect: number; maxSelect: number; required: boolean; options: { name: string; priceDelta: number }[] }[] = [
  {
    name: 'Spice level',
    minSelect: 1, maxSelect: 1, required: true,
    options: [
      { name: 'Mild', priceDelta: 0 },
      { name: 'Medium', priceDelta: 0 },
      { name: 'Spicy', priceDelta: 0 },
      { name: 'Extra spicy', priceDelta: 0 },
    ],
  },
  {
    name: 'Add-ons',
    minSelect: 0, maxSelect: 5, required: false,
    options: [
      { name: 'Extra cheese', priceDelta: 40 },
      { name: 'Extra gravy', priceDelta: 30 },
      { name: 'Butter topping', priceDelta: 20 },
      { name: 'Extra raita', priceDelta: 25 },
    ],
  },
  {
    name: 'Preparation',
    minSelect: 0, maxSelect: 3, required: false,
    options: [
      { name: 'No onion', priceDelta: 0 },
      { name: 'No garlic', priceDelta: 0 },
      { name: 'Less oil', priceDelta: 0 },
      { name: 'Jain (no root veg)', priceDelta: 0 },
    ],
  },
];

export const INDIAN_MENU_CATALOG: CatalogItem[] = [
  // ── Starters / Tandoori ──────────────────────────────────────────────────
  { category: 'Starters', name: 'Paneer Tikka', description: 'Marinated cottage cheese, char-grilled', isVeg: true, basePrice: 240, variantSuggestions: [{ name: 'Half (6 pc)', price: 240 }, { name: 'Full (12 pc)', price: 420 }] },
  { category: 'Starters', name: 'Veg Spring Roll', description: 'Crispy rolls with mixed vegetables', isVeg: true, basePrice: 160 },
  { category: 'Starters', name: 'Gobi Manchurian', description: 'Indo-Chinese cauliflower in spicy sauce', isVeg: true, basePrice: 190, variantSuggestions: [{ name: 'Half', price: 190 }, { name: 'Full', price: 320 }] },
  { category: 'Starters', name: 'Chicken Tikka', description: 'Boneless chicken, tandoor-grilled', isVeg: false, basePrice: 290, variantSuggestions: [{ name: 'Half (6 pc)', price: 290 }, { name: 'Full (12 pc)', price: 520 }] },
  { category: 'Starters', name: 'Tandoori Chicken', description: 'Classic spiced char-grilled chicken', isVeg: false, basePrice: 320, variantSuggestions: [{ name: 'Half', price: 320 }, { name: 'Full', price: 580 }] },
  { category: 'Starters', name: 'Chicken 65', description: 'Spicy South-Indian fried chicken', isVeg: false, basePrice: 260 },

  // ── Soups ────────────────────────────────────────────────────────────────
  { category: 'Soups', name: 'Veg Manchow Soup', description: 'Spicy soup with crispy noodles', isVeg: true, basePrice: 130 },
  { category: 'Soups', name: 'Sweet Corn Soup', description: 'Creamy corn soup', isVeg: true, basePrice: 130 },
  { category: 'Soups', name: 'Chicken Hot & Sour Soup', description: 'Tangy, peppery chicken soup', isVeg: false, basePrice: 160 },

  // ── Veg Curries ──────────────────────────────────────────────────────────
  { category: 'Veg Main Course', name: 'Paneer Butter Masala', description: 'Cottage cheese in rich tomato-butter gravy', isVeg: true, basePrice: 260, variantSuggestions: [{ name: 'Half', price: 260 }, { name: 'Full', price: 420 }] },
  { category: 'Veg Main Course', name: 'Dal Makhani', description: 'Slow-cooked black lentils with cream', isVeg: true, basePrice: 220, variantSuggestions: [{ name: 'Half', price: 220 }, { name: 'Full', price: 360 }] },
  { category: 'Veg Main Course', name: 'Palak Paneer', description: 'Cottage cheese in spinach gravy', isVeg: true, basePrice: 250, variantSuggestions: [{ name: 'Half', price: 250 }, { name: 'Full', price: 400 }] },
  { category: 'Veg Main Course', name: 'Chana Masala', description: 'Spiced chickpea curry', isVeg: true, basePrice: 200, variantSuggestions: [{ name: 'Half', price: 200 }, { name: 'Full', price: 320 }] },
  { category: 'Veg Main Course', name: 'Mixed Veg Curry', description: 'Seasonal vegetables in onion-tomato gravy', isVeg: true, basePrice: 220, variantSuggestions: [{ name: 'Half', price: 220 }, { name: 'Full', price: 350 }] },

  // ── Non-veg Curries ──────────────────────────────────────────────────────
  { category: 'Non-Veg Main Course', name: 'Butter Chicken', description: 'Tandoori chicken in creamy tomato gravy', isVeg: false, basePrice: 320, variantSuggestions: [{ name: 'Half', price: 320 }, { name: 'Full', price: 520 }] },
  { category: 'Non-Veg Main Course', name: 'Chicken Curry', description: 'Home-style chicken in spiced gravy', isVeg: false, basePrice: 300, variantSuggestions: [{ name: 'Half', price: 300 }, { name: 'Full', price: 480 }] },
  { category: 'Non-Veg Main Course', name: 'Mutton Rogan Josh', description: 'Kashmiri-style mutton curry', isVeg: false, basePrice: 420, variantSuggestions: [{ name: 'Half', price: 420 }, { name: 'Full', price: 700 }] },
  { category: 'Non-Veg Main Course', name: 'Fish Curry', description: 'Coastal-style fish in tangy gravy', isVeg: false, basePrice: 340, variantSuggestions: [{ name: 'Half', price: 340 }, { name: 'Full', price: 560 }] },

  // ── Biryani & Rice ─────────────────────────────────────────────────────────
  { category: 'Biryani & Rice', name: 'Veg Biryani', description: 'Fragrant basmati with vegetables', isVeg: true, basePrice: 220, variantSuggestions: [{ name: 'Half', price: 220 }, { name: 'Full', price: 350 }] },
  { category: 'Biryani & Rice', name: 'Chicken Biryani', description: 'Hyderabadi-style dum biryani', isVeg: false, basePrice: 280, variantSuggestions: [{ name: 'Half', price: 280 }, { name: 'Full', price: 440 }] },
  { category: 'Biryani & Rice', name: 'Mutton Biryani', description: 'Slow-cooked mutton dum biryani', isVeg: false, basePrice: 360, variantSuggestions: [{ name: 'Half', price: 360 }, { name: 'Full', price: 560 }] },
  { category: 'Biryani & Rice', name: 'Jeera Rice', description: 'Cumin-tempered basmati', isVeg: true, basePrice: 150, variantSuggestions: [{ name: 'Regular', price: 150 }, { name: 'Large', price: 230 }] },

  // ── Breads ───────────────────────────────────────────────────────────────
  { category: 'Breads', name: 'Tandoori Roti', description: 'Whole-wheat clay-oven bread', isVeg: true, basePrice: 35 },
  { category: 'Breads', name: 'Butter Naan', description: 'Soft leavened bread with butter', isVeg: true, basePrice: 55 },
  { category: 'Breads', name: 'Garlic Naan', description: 'Naan topped with garlic + coriander', isVeg: true, basePrice: 70 },
  { category: 'Breads', name: 'Laccha Paratha', description: 'Flaky multi-layered bread', isVeg: true, basePrice: 60 },

  // ── South Indian ───────────────────────────────────────────────────────────
  { category: 'South Indian', name: 'Masala Dosa', description: 'Crispy crepe with spiced potato', isVeg: true, basePrice: 130 },
  { category: 'South Indian', name: 'Plain Dosa', description: 'Crispy rice-lentil crepe', isVeg: true, basePrice: 100 },
  { category: 'South Indian', name: 'Idli (2 pc)', description: 'Steamed rice cakes with sambar + chutney', isVeg: true, basePrice: 80 },
  { category: 'South Indian', name: 'Medu Vada (2 pc)', description: 'Crispy lentil doughnuts', isVeg: true, basePrice: 90 },

  // ── Indo-Chinese ───────────────────────────────────────────────────────────
  { category: 'Chinese', name: 'Veg Fried Rice', description: 'Wok-tossed rice with vegetables', isVeg: true, basePrice: 180, variantSuggestions: [{ name: 'Half', price: 180 }, { name: 'Full', price: 290 }] },
  { category: 'Chinese', name: 'Veg Hakka Noodles', description: 'Stir-fried noodles with vegetables', isVeg: true, basePrice: 180, variantSuggestions: [{ name: 'Half', price: 180 }, { name: 'Full', price: 290 }] },
  { category: 'Chinese', name: 'Chicken Fried Rice', description: 'Wok-tossed rice with chicken', isVeg: false, basePrice: 220, variantSuggestions: [{ name: 'Half', price: 220 }, { name: 'Full', price: 350 }] },
  { category: 'Chinese', name: 'Chilli Chicken', description: 'Indo-Chinese chicken in spicy sauce', isVeg: false, basePrice: 260, variantSuggestions: [{ name: 'Half', price: 260 }, { name: 'Full', price: 420 }] },

  // ── Desserts ───────────────────────────────────────────────────────────────
  { category: 'Desserts', name: 'Gulab Jamun (2 pc)', description: 'Warm milk-solid dumplings in syrup', isVeg: true, basePrice: 90 },
  { category: 'Desserts', name: 'Gajar Halwa', description: 'Carrot pudding with nuts', isVeg: true, basePrice: 120 },
  { category: 'Desserts', name: 'Rasmalai (2 pc)', description: 'Cottage-cheese discs in saffron milk', isVeg: true, basePrice: 110 },

  // ── Beverages ──────────────────────────────────────────────────────────────
  { category: 'Beverages', name: 'Sweet Lassi', description: 'Sweet yogurt drink', isVeg: true, basePrice: 90, variantSuggestions: [{ name: 'Regular', price: 90 }, { name: 'Large', price: 140 }] },
  { category: 'Beverages', name: 'Masala Chai', description: 'Spiced Indian tea', isVeg: true, basePrice: 40, variantSuggestions: [{ name: 'Small', price: 40 }, { name: 'Regular', price: 60 }] },
  { category: 'Beverages', name: 'Fresh Lime Soda', description: 'Sweet or salted', isVeg: true, basePrice: 70 },
  { category: 'Beverages', name: 'Mango Lassi', description: 'Mango yogurt smoothie', isVeg: true, basePrice: 120, variantSuggestions: [{ name: 'Regular', price: 120 }, { name: 'Large', price: 170 }] },
];

/** Suggest variant labels for a dish name by keyword match against the catalog. */
export function suggestVariantsForName(name: string): string[] {
  const lower = name.toLowerCase();
  // Exact catalog match first.
  const exact = INDIAN_MENU_CATALOG.find((c) => c.name.toLowerCase() === lower);
  if (exact?.variantSuggestions?.length) return exact.variantSuggestions.map((v) => v.name);
  // Keyword fallback.
  for (const [kw, labels] of Object.entries(VARIANT_SUGGESTIONS_BY_KEYWORD)) {
    if (lower.includes(kw.replace('_', ' ')) || lower.includes(kw)) return labels;
  }
  return [];
}
