/**
 * Cuisine starter templates for the onboarding menu step, plus the example
 * CSV offered for download. Pure data + helpers (client- and server-safe).
 *
 * These are EDITABLE SAMPLES: typical dishes and mid-market Indian prices
 * (₹, 2026) so a new menu never starts empty or at ₹0. The owner reviews,
 * edits or untick items before anything is saved, and the UI labels them as
 * samples throughout. Rows feed the existing menu import engine
 * (src/server/menu-io.ts → applyMenuImport), so templates, CSV import and
 * manual add all share one write path.
 */

export interface TemplateItem {
  category: string;
  name: string;
  description: string;
  price: number; // ₹
  isVeg: boolean;
  spicyLevel: 0 | 1 | 2 | 3;
  prepTimeMin: number;
}

export interface MenuTemplate {
  id: string;
  title: string;
  blurb: string;
  items: TemplateItem[];
}

const i = (
  category: string, name: string, description: string, price: number,
  isVeg: boolean, spicyLevel: 0 | 1 | 2 | 3, prepTimeMin: number,
): TemplateItem => ({ category, name, description, price, isVeg, spicyLevel, prepTimeMin });

export const MENU_TEMPLATES: readonly MenuTemplate[] = [
  {
    id: 'north-indian',
    title: 'North Indian',
    blurb: 'Tandoor starters, rich gravies, breads and biryani.',
    items: [
      i('Starters', 'Paneer Tikka', 'Cottage cheese cubes marinated in spiced yoghurt, charred in the tandoor.', 260, true, 2, 20),
      i('Starters', 'Hara Bhara Kebab', 'Spinach, green pea and potato patties, shallow-fried. 6 pcs.', 210, true, 1, 15),
      i('Starters', 'Chicken Tikka', 'Boneless chicken in tandoori masala, served with mint chutney.', 320, false, 2, 20),
      i('Main Course', 'Paneer Butter Masala', 'Paneer in a buttery tomato-cashew gravy.', 280, true, 1, 20),
      i('Main Course', 'Dal Makhani', 'Black lentils slow-cooked overnight with butter and cream.', 240, true, 0, 15),
      i('Main Course', 'Chana Masala', 'Chickpeas simmered in an onion-tomato masala.', 210, true, 2, 15),
      i('Main Course', 'Butter Chicken', 'Tandoori chicken in a velvety makhani gravy.', 360, false, 1, 25),
      i('Main Course', 'Kadai Chicken', 'Chicken tossed with capsicum, onion and freshly ground kadai masala.', 340, false, 3, 25),
      i('Breads', 'Tandoori Roti', 'Whole-wheat flatbread from the clay oven.', 30, true, 0, 8),
      i('Breads', 'Butter Naan', 'Soft leavened bread brushed with butter.', 60, true, 0, 8),
      i('Breads', 'Garlic Naan', 'Naan topped with garlic and coriander.', 80, true, 0, 8),
      i('Rice & Biryani', 'Jeera Rice', 'Basmati rice tempered with cumin.', 160, true, 0, 10),
      i('Rice & Biryani', 'Chicken Dum Biryani', 'Basmati and chicken layered and slow-cooked on dum. Served with raita.', 320, false, 2, 30),
      i('Desserts', 'Gulab Jamun', 'Two warm milk dumplings in rose-cardamom syrup.', 90, true, 0, 5),
    ],
  },
  {
    id: 'south-indian',
    title: 'South Indian',
    blurb: 'Tiffin classics, dosas, rice meals and filter coffee.',
    items: [
      i('Tiffin', 'Idli', 'Two steamed rice cakes with sambar and coconut chutney.', 60, true, 0, 8),
      i('Tiffin', 'Medu Vada', 'Two crisp urad dal fritters with sambar and chutney.', 70, true, 1, 10),
      i('Tiffin', 'Ven Pongal', 'Rice and moong dal with pepper, cumin and ghee.', 100, true, 1, 10),
      i('Tiffin', 'Rava Upma', 'Semolina cooked with vegetables, mustard and curry leaves.', 80, true, 1, 10),
      i('Dosa', 'Plain Dosa', 'Thin, crisp rice-lentil crêpe.', 90, true, 0, 10),
      i('Dosa', 'Masala Dosa', 'Crisp dosa filled with spiced potato palya.', 110, true, 1, 12),
      i('Dosa', 'Mysore Masala Dosa', 'Dosa layered with red chutney and potato palya.', 130, true, 2, 12),
      i('Dosa', 'Onion Uttapam', 'Thick rice pancake topped with onion, chilli and coriander.', 120, true, 1, 12),
      i('Meals', 'South Indian Thali', 'Rice, sambar, rasam, two poriyals, curd, papad and payasam.', 220, true, 1, 15),
      i('Meals', 'Bisi Bele Bath', 'Rice, lentils and vegetables cooked with a tangy spice blend.', 130, true, 2, 12),
      i('Meals', 'Curd Rice', 'Rice with curd, tempered with mustard, ginger and curry leaves.', 110, true, 0, 8),
      i('Meals', 'Chettinad Chicken Curry', 'Chicken in a pepper-forward roasted spice gravy.', 280, false, 3, 25),
      i('Beverages', 'Filter Coffee', 'Strong decoction with hot frothy milk.', 40, true, 0, 5),
      i('Desserts', 'Kesari Bath', 'Semolina sweet with ghee, saffron and cashews.', 60, true, 0, 5),
    ],
  },
  {
    id: 'chinese',
    title: 'Chinese (Indo-Chinese)',
    blurb: 'Soups, wok starters, noodles and fried rice.',
    items: [
      i('Soups', 'Veg Manchow Soup', 'Spicy vegetable soup topped with crispy noodles.', 140, true, 2, 10),
      i('Soups', 'Chicken Hot & Sour Soup', 'Peppery, tangy soup with shredded chicken.', 160, false, 2, 10),
      i('Starters', 'Veg Spring Rolls', 'Crisp rolls with cabbage, carrot and glass noodles. 4 pcs.', 180, true, 1, 15),
      i('Starters', 'Crispy Honey Chilli Potato', 'Fried potato fingers tossed in honey-chilli glaze.', 200, true, 2, 15),
      i('Starters', 'Chilli Paneer (Dry)', 'Paneer tossed with capsicum, onion and soy-chilli sauce.', 240, true, 2, 15),
      i('Starters', 'Chicken Lollipop', 'Frenched wings, fried and served with Schezwan dip. 6 pcs.', 280, false, 2, 20),
      i('Noodles & Rice', 'Veg Hakka Noodles', 'Wok-tossed noodles with vegetables.', 190, true, 1, 12),
      i('Noodles & Rice', 'Chicken Schezwan Noodles', 'Noodles with chicken in fiery Schezwan sauce.', 230, false, 3, 12),
      i('Noodles & Rice', 'Veg Fried Rice', 'Wok-fried rice with vegetables and spring onion.', 180, true, 0, 12),
      i('Noodles & Rice', 'Egg Fried Rice', 'Fried rice with scrambled egg and spring onion.', 200, false, 0, 12),
      i('Main Course', 'Veg Manchurian Gravy', 'Vegetable dumplings in a garlicky soy gravy.', 210, true, 2, 15),
      i('Main Course', 'Chilli Chicken Gravy', 'Chicken in a spicy chilli-soy gravy.', 270, false, 3, 18),
      i('Desserts', 'Date Pancake with Ice Cream', 'Crisp pancake filled with dates, served with vanilla ice cream.', 180, true, 0, 12),
    ],
  },
  {
    id: 'cafe-bakery',
    title: 'Café / Bakery',
    blurb: 'Coffee, fresh bakes, sandwiches and quick bites.',
    items: [
      i('Hot Beverages', 'Masala Chai', 'Assam tea brewed with ginger, cardamom and milk.', 60, true, 0, 5),
      i('Hot Beverages', 'Cappuccino', 'Double espresso with steamed, foamed milk.', 160, true, 0, 5),
      i('Hot Beverages', 'Café Latte', 'Espresso with silky steamed milk.', 170, true, 0, 5),
      i('Cold Beverages', 'Classic Cold Coffee', 'Blended coffee, milk and ice.', 180, true, 0, 5),
      i('Cold Beverages', 'Iced Lemon Tea', 'Black tea with lemon, mint and ice.', 140, true, 0, 5),
      i('Bakes', 'Butter Croissant', 'Flaky, all-butter croissant baked fresh every morning.', 120, true, 0, 3),
      i('Bakes', 'Chocolate Muffin', 'Moist chocolate muffin with chocolate chips.', 110, true, 0, 3),
      i('Bakes', 'Banana Walnut Bread', 'A thick slice of banana bread with walnuts.', 120, true, 0, 3),
      i('Bakes', 'Blueberry Cheesecake', 'Baked cheesecake slice with blueberry compote.', 220, true, 0, 3),
      i('Bakes', 'Egg Puff', 'Puff pastry with a spiced boiled-egg filling.', 50, false, 1, 5),
      i('Sandwiches', 'Grilled Veg Cheese Sandwich', 'Vegetables, mint chutney and cheese, grilled.', 180, true, 1, 10),
      i('Sandwiches', 'Chicken Pesto Sandwich', 'Grilled chicken, basil pesto and lettuce on sourdough.', 240, false, 0, 10),
    ],
  },
  {
    id: 'pizza',
    title: 'Pizza',
    blurb: 'Medium pizzas, sides, pasta and desserts.',
    items: [
      i('Pizzas (Medium)', 'Margherita', 'Tomato sauce, mozzarella and basil.', 249, true, 0, 15),
      i('Pizzas (Medium)', 'Farmhouse', 'Onion, capsicum, tomato and mushroom.', 349, true, 0, 15),
      i('Pizzas (Medium)', 'Peppy Paneer', 'Paneer, capsicum and red paprika.', 359, true, 1, 15),
      i('Pizzas (Medium)', 'Paneer Tikka Pizza', 'Tandoori paneer, onion and mint mayo drizzle.', 379, true, 2, 15),
      i('Pizzas (Medium)', 'Chicken Pepperoni', 'Chicken pepperoni with extra mozzarella.', 429, false, 1, 15),
      i('Pizzas (Medium)', 'BBQ Chicken', 'BBQ-glazed chicken, onion and jalapeño.', 449, false, 2, 15),
      i('Sides', 'Garlic Breadsticks', 'Oven-baked breadsticks with garlic butter. Served with dip.', 129, true, 0, 10),
      i('Sides', 'Cheesy Garlic Bread', 'Garlic bread loaded with mozzarella.', 159, true, 0, 10),
      i('Sides', 'Peri Peri Fries', 'Fries tossed in peri peri seasoning.', 129, true, 2, 8),
      i('Sides', 'Chicken Wings', 'Six baked wings tossed in smoky hot sauce.', 249, false, 2, 15),
      i('Pasta', 'Penne Arrabbiata', 'Penne in a spicy tomato-garlic sauce.', 229, true, 2, 12),
      i('Pasta', 'Creamy Alfredo Pasta', 'Penne in a parmesan cream sauce with herbs.', 249, true, 0, 12),
      i('Beverages', 'Soft Drink (500 ml)', 'Chilled soft drink — tell customers which brands you stock.', 60, true, 0, 1),
      i('Desserts', 'Choco Lava Cake', 'Warm chocolate cake with a molten centre.', 109, true, 0, 8),
    ],
  },
];

export function getTemplate(id: string): MenuTemplate | undefined {
  return MENU_TEMPLATES.find((t) => t.id === id);
}

/** Matches the MenuRow shape consumed by applyMenuImport (src/server/menu-io.ts). */
export interface TemplateMenuRow {
  category: string;
  name: string;
  description?: string;
  price: number;
  isVeg: boolean;
  spicyLevel: number;
  prepTimeMin: number;
  isAvailable: boolean;
}

/** An owner's edit to one template row (index into template.items). */
export interface TemplateSelection {
  index: number;
  include: boolean;
  name?: string;
  price?: number;
  category?: string;
}

export class TemplateError extends Error {}

/**
 * Turn a template + the owner's per-row edits into import rows. Rows with no
 * selection entry are included unchanged. Throws TemplateError on an unknown
 * template, an out-of-range index, a blank name, a bad price, or when nothing
 * is left to import.
 */
export function templateToMenuRows(templateId: string, selections: TemplateSelection[] = []): TemplateMenuRow[] {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new TemplateError(`Unknown menu template "${templateId}".`);
  const byIndex = new Map<number, TemplateSelection>();
  for (const s of selections) {
    if (!Number.isInteger(s.index) || s.index < 0 || s.index >= tpl.items.length) {
      throw new TemplateError(`Template row ${s.index + 1} does not exist.`);
    }
    byIndex.set(s.index, s);
  }
  const rows: TemplateMenuRow[] = [];
  tpl.items.forEach((item, idx) => {
    const sel = byIndex.get(idx);
    if (sel && !sel.include) return;
    const name = (sel?.name ?? item.name).trim();
    const category = (sel?.category ?? item.category).trim();
    const price = sel?.price ?? item.price;
    if (!name) throw new TemplateError(`Row ${idx + 1}: dish name can't be blank.`);
    if (!category) throw new TemplateError(`Row ${idx + 1}: category can't be blank.`);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) {
      throw new TemplateError(`Row ${idx + 1} (${name}): price must be between ₹1 and ₹1,00,000.`);
    }
    rows.push({
      category, name, description: item.description, price: Math.round(price * 100) / 100,
      isVeg: item.isVeg, spicyLevel: item.spicyLevel, prepTimeMin: item.prepTimeMin, isAvailable: true,
    });
  });
  if (rows.length === 0) throw new TemplateError('Select at least one dish to add.');
  return rows;
}

// ── Example CSV ──────────────────────────────────────────────────────────────

export const CSV_HEADERS = ['Category', 'Item Name', 'Description', 'Price', 'Veg', 'Spicy Level', 'Prep Time (min)', 'Available'] as const;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Example import file: a few rows from several templates so owners see veg and
 * non-veg, spice levels, an "unavailable" row and quoted commas. Its header
 * row is exactly what the import engine expects.
 */
export function buildExampleCsv(): string {
  const pick = (tid: string, names: string[]) =>
    getTemplate(tid)!.items.filter((it) => names.includes(it.name));
  const rows = [
    ...pick('north-indian', ['Paneer Tikka', 'Butter Chicken', 'Butter Naan']),
    ...pick('south-indian', ['Masala Dosa', 'Filter Coffee']),
    ...pick('chinese', ['Veg Hakka Noodles']),
  ];
  const lines = [CSV_HEADERS.join(',')];
  rows.forEach((r, idx) => {
    lines.push([
      r.category, r.name, r.description, r.price, r.isVeg ? 'Veg' : 'Non-Veg', r.spicyLevel, r.prepTimeMin,
      idx === rows.length - 1 ? 'No' : 'Yes',
    ].map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}
