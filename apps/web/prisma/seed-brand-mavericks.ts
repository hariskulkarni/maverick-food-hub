/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  seed-brand-mavericks.ts — "Group of Cuisines" umbrella brand seed
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  What it does
 *  ------------
 *  Creates (or updates) the umbrella Brand "Group of Cuisines" (renamed from
 *  the legacy "Maverick Hospitality" slug) plus seven cuisine concepts under
 *  it. Each cuisine is a fully demo-able Restaurant tenant with:
 *
 *     - 1 Branch (Andhra Pradesh, spread across Visakhapatnam/Vijayawada/Guntur/...)
 *     - 4-6 Categories
 *     - 25-40 MenuItems
 *     - 2-3 Combos
 *     - 1 Admin user + 1 Kitchen user (with Argon2id passwords)
 *     - 2 Customer users
 *     - 3 Riders with full KYC (AADHAAR / DL / VEHICLE_INSURANCE — APPROVED)
 *     - 2 Offers (one auto-apply percent, one fixed code)
 *     - 1 HappyHourRule + 7 daily schedules
 *     - 5-8 sample Orders spanning RECEIVED → DELIVERED + a cancellation
 *
 *  Idempotency
 *  -----------
 *  Every entity is `upsert`-ed (or `findFirst → update | create` for tables
 *  that have no unique index covering the natural key). Re-runs will not
 *  duplicate rows. Order codes are deterministic (`ORD-GOC-<slug>-<n>`) so
 *  orders aren't duplicated either.
 *
 *  Brand rename migration
 *  ----------------------
 *  If a Brand with slug=`maverick-hospitality` already exists from an earlier
 *  run, it is renamed in-place to slug=`group-of-cuisines` / name="Group of
 *  Cuisines", preserving its id and the FK link to its restaurants.
 *
 *  How to run
 *  ----------
 *      cd apps/web
 *      npm run db:seed:cuisines       (or `npx tsx prisma/seed-brand-mavericks.ts`)
 *
 *  Requires DATABASE_URL.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient, Role, RestaurantStatus, OrderStatus, PaymentMethod, CancellationReason } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// ─── helpers ──────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Deterministic short suffix per restaurant slug → used for customer phones.
function digitsOf(input: string, len: number): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  const s = h.toString().padStart(len, '0');
  return s.slice(-len);
}

const BRAND_LOGO =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&auto=format&fit=crop&q=80';
const BRAND_COVER =
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&auto=format&fit=crop&q=80';
const FALLBACK_FOOD_IMAGE =
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=80';

// ─── types ────────────────────────────────────────────────────────────────
type ItemSeed = {
  name: string;
  price: number;
  isVeg: boolean;
  spicy?: 0 | 1 | 2 | 3;
  prep?: number;
  description: string;
  category: string; // category slug
  image?: string;
};

type ComboSeed = {
  name: string;
  description: string;
  items: { itemSlug: string; quantity: number }[];
};

type CuisineSeed = {
  slug: string;
  name: string;
  cuisine: string;
  tagline: string;
  description: string;
  logoUrl: string;
  coverImageUrl: string;
  area: string; // Andhra Pradesh area
  city: string; // Andhra Pradesh city
  line1: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  categories: { slug: string; name: string }[];
  items: ItemSeed[];
  combos: ComboSeed[];
  happyHour: {
    name: string;
    description: string;
    startMin: number;
    endMin: number;
    percentOff: number;
  };
};

// ─── cuisine seed data ────────────────────────────────────────────────────
const CUISINES: CuisineSeed[] = [
  // ── Mozza Italia ────────────────────────────────────────────────────────
  {
    slug: 'italia-pizza',
    name: 'Mozza Italia',
    cuisine: 'Italian',
    tagline: 'Wood-fired. Hand-stretched. Unapologetically Italian.',
    description:
      'Thin-crust Neapolitan pizzas with imported San Marzano tomatoes, fior-di-latte mozzarella, and pastas made fresh every morning.',
    logoUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1600&auto=format&fit=crop&q=80',
    area: 'Brodipet',
    city: 'Guntur',
    line1: '4/2, Brodipet, near Kothapet',
    postalCode: '522002',
    latitude: 16.3010,
    longitude: 80.4360,
    categories: [
      { slug: 'pizzas', name: 'Pizzas' },
      { slug: 'pastas', name: 'Pastas' },
      { slug: 'risotto', name: 'Risotto' },
      { slug: 'salads', name: 'Salads' },
      { slug: 'desserts', name: 'Desserts' },
      { slug: 'beverages', name: 'Beverages' }
    ],
    items: [
      { name: 'Margherita', price: 320, isVeg: true, spicy: 0, prep: 18, description: 'San Marzano tomato, fior-di-latte, basil, a kiss of olive oil.', category: 'pizzas' },
      { name: 'Quattro Formaggi', price: 480, isVeg: true, spicy: 0, prep: 20, description: 'Four-cheese blend with mozzarella, gorgonzola, parmesan and fontina.', category: 'pizzas' },
      { name: 'Pepperoni', price: 460, isVeg: false, spicy: 2, prep: 20, description: 'Spicy pepperoni, mozzarella, oregano. The crowd-pleaser.', category: 'pizzas' },
      { name: 'Diavola', price: 470, isVeg: false, spicy: 3, prep: 20, description: 'Calabrian salami, chilli flakes, garlic and mozzarella.', category: 'pizzas' },
      { name: 'Capricciosa', price: 490, isVeg: false, spicy: 1, prep: 22, description: 'Ham, mushrooms, artichokes and olives — four toppings, one classic.', category: 'pizzas' },
      { name: 'Funghi', price: 420, isVeg: true, spicy: 0, prep: 20, description: 'Mixed wild mushrooms, mozzarella, truffle oil drizzle.', category: 'pizzas' },
      { name: 'Tartufo', price: 590, isVeg: true, spicy: 0, prep: 22, description: 'Black truffle, ricotta, mozzarella, finished with truffle honey.', category: 'pizzas' },
      { name: 'Pizza Bianca', price: 380, isVeg: true, spicy: 0, prep: 18, description: 'White pizza with garlic, rosemary, mozzarella and olive oil — no tomato.', category: 'pizzas' },
      { name: 'Calzone Classico', price: 440, isVeg: false, spicy: 1, prep: 22, description: 'Folded pizza stuffed with ham, ricotta and mozzarella.', category: 'pizzas' },
      { name: 'Spaghetti Bolognese', price: 360, isVeg: false, spicy: 1, prep: 22, description: 'Slow-simmered beef ragu over spaghetti, parmesan shavings.', category: 'pastas' },
      { name: 'Spaghetti Carbonara', price: 380, isVeg: false, spicy: 0, prep: 18, description: 'Pancetta, egg yolk, pecorino and cracked black pepper. No cream.', category: 'pastas' },
      { name: 'Cacio e Pepe', price: 320, isVeg: true, spicy: 1, prep: 15, description: 'Pecorino romano, black pepper, tonarelli pasta. Three ingredients, total magic.', category: 'pastas' },
      { name: "Penne all'Arrabbiata", price: 290, isVeg: true, spicy: 3, prep: 16, description: 'Garlic, chilli and tomato pomodoro tossed with penne.', category: 'pastas' },
      { name: 'Fettuccine Alfredo', price: 340, isVeg: true, spicy: 0, prep: 18, description: 'Butter, parmesan and freshly grated pepper over fettuccine.', category: 'pastas' },
      { name: 'Lasagne al Forno', price: 420, isVeg: false, spicy: 0, prep: 25, description: 'Layered pasta sheets, ragu, bechamel and bubbling parmesan crust.', category: 'pastas' },
      { name: 'Pesto Genovese', price: 330, isVeg: true, spicy: 0, prep: 16, description: 'Basil-pine-nut pesto with trofie pasta and a touch of pecorino.', category: 'pastas' },
      { name: 'Risotto ai Funghi', price: 410, isVeg: true, spicy: 0, prep: 25, description: 'Arborio rice slow-stirred with mixed mushrooms and parmesan.', category: 'risotto' },
      { name: 'Saffron Risotto Milanese', price: 440, isVeg: true, spicy: 0, prep: 25, description: 'Classic Milan-style saffron risotto, butter-finished.', category: 'risotto' },
      { name: 'Risotto al Limone', price: 420, isVeg: true, spicy: 0, prep: 25, description: 'Bright lemon-zested risotto with mascarpone and chives.', category: 'risotto' },
      { name: 'Caesar Salad', price: 280, isVeg: false, spicy: 0, prep: 10, description: 'Romaine, anchovy dressing, crouton crunch, parmesan.', category: 'salads' },
      { name: 'Caprese', price: 260, isVeg: true, spicy: 0, prep: 8, description: 'Buffalo mozzarella, ripe tomato, basil, olive oil.', category: 'salads' },
      { name: 'Insalata Mista', price: 230, isVeg: true, spicy: 0, prep: 8, description: 'Mixed greens, balsamic vinaigrette, shaved pecorino.', category: 'salads' },
      { name: 'Burrata Plate', price: 460, isVeg: true, spicy: 0, prep: 8, description: 'A whole burrata over heritage tomatoes with olive oil and basil.', category: 'salads' },
      { name: 'Antipasto Misto', price: 520, isVeg: false, spicy: 0, prep: 10, description: 'Cured meats, marinated olives, mozzarella and grilled vegetables.', category: 'salads' },
      { name: 'Tiramisu', price: 220, isVeg: true, spicy: 0, prep: 5, description: 'Espresso-soaked savoiardi layered with mascarpone cream.', category: 'desserts' },
      { name: 'Panna Cotta', price: 200, isVeg: true, spicy: 0, prep: 5, description: 'Vanilla-bean panna cotta with mixed berry coulis.', category: 'desserts' },
      { name: 'Cannoli (2 pc)', price: 220, isVeg: true, spicy: 0, prep: 5, description: 'Sicilian fried pastry shells stuffed with sweet ricotta and pistachio.', category: 'desserts' },
      { name: 'Affogato', price: 180, isVeg: true, spicy: 0, prep: 4, description: 'Vanilla gelato drowned in a fresh shot of espresso.', category: 'desserts' },
      { name: 'Espresso', price: 120, isVeg: true, spicy: 0, prep: 3, description: 'Double-shot Italian espresso.', category: 'beverages' },
      { name: 'Aperol Spritz (non-alc)', price: 220, isVeg: true, spicy: 0, prep: 4, description: 'Mocktail spritz with orange, bitters and soda.', category: 'beverages' },
      { name: 'San Pellegrino', price: 180, isVeg: true, spicy: 0, prep: 2, description: 'Chilled sparkling mineral water.', category: 'beverages' },
      { name: 'House Iced Tea', price: 140, isVeg: true, spicy: 0, prep: 3, description: 'Cold-brewed black tea with lemon and basil.', category: 'beverages' }
    ],
    combos: [
      { name: 'Pizza Date Combo', description: 'Margherita + Caesar Salad + 2 Espressos', items: [{ itemSlug: 'margherita', quantity: 1 }, { itemSlug: 'caesar-salad', quantity: 1 }, { itemSlug: 'espresso', quantity: 2 }] },
      { name: 'Family Italian Feast', description: 'Pepperoni + Spaghetti Bolognese + Tiramisu + Iced Tea', items: [{ itemSlug: 'pepperoni', quantity: 1 }, { itemSlug: 'spaghetti-bolognese', quantity: 1 }, { itemSlug: 'tiramisu', quantity: 1 }, { itemSlug: 'house-iced-tea', quantity: 1 }] },
      { name: 'Pasta Lover Trio', description: 'Carbonara + Cacio e Pepe + Panna Cotta', items: [{ itemSlug: 'spaghetti-carbonara', quantity: 1 }, { itemSlug: 'cacio-e-pepe', quantity: 1 }, { itemSlug: 'panna-cotta', quantity: 1 }] }
    ],
    happyHour: { name: 'Pizza Hour', description: '20% off all pizzas, 4-7pm daily.', startMin: 16 * 60, endMin: 19 * 60, percentOff: 20 }
  },

  // ── Biryani Zone ────────────────────────────────────────────────────────
  {
    slug: 'biryani-zone',
    name: 'Biryani Zone',
    cuisine: 'Indian',
    tagline: 'Dum-cooked biryanis. Nothing else matters.',
    description:
      'Hyderabadi and Lucknowi biryanis layered with marinated meats and saffron-soaked basmati, sealed and slow-cooked for hours.',
    logoUrl: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=1600&auto=format&fit=crop&q=80',
    area: 'Arundelpet',
    city: 'Guntur',
    line1: 'Arundelpet 6th Line',
    postalCode: '522002',
    latitude: 16.3050,
    longitude: 80.4420,
    categories: [
      { slug: 'hyderabadi-biryani', name: 'Hyderabadi Biryani' },
      { slug: 'lucknowi-biryani', name: 'Lucknowi Biryani' },
      { slug: 'kebabs', name: 'Kebabs' },
      { slug: 'curries', name: 'Curries' },
      { slug: 'breads', name: 'Breads' },
      { slug: 'beverages', name: 'Beverages' }
    ],
    items: [
      { name: 'Hyderabadi Chicken Dum Biryani', price: 320, isVeg: false, spicy: 2, prep: 25, description: 'Slow-cooked basmati layered with hand-cut chicken thighs, saffron and fried onions.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Mutton Biryani', price: 460, isVeg: false, spicy: 2, prep: 35, description: 'Slow-braised mutton on the bone, signature Hyderabadi spice and aromatic basmati.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Veg Biryani', price: 260, isVeg: true, spicy: 2, prep: 22, description: 'Mixed vegetables in classic dum style with whole spices and mint.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Egg Biryani', price: 240, isVeg: false, spicy: 2, prep: 20, description: 'Soft-boiled eggs gently folded into dum-cooked saffron basmati.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Prawn Biryani', price: 420, isVeg: false, spicy: 2, prep: 28, description: 'Plump prawns marinated in green-chilli paste and dum-cooked.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Fish Biryani', price: 410, isVeg: false, spicy: 2, prep: 28, description: 'Coastal-style biryani with marinated bekti fillets and curry leaves.', category: 'hyderabadi-biryani' },
      { name: 'Hyderabadi Paneer Biryani', price: 290, isVeg: true, spicy: 1, prep: 22, description: 'Tikka-marinated paneer cubes layered with basmati and saffron milk.', category: 'hyderabadi-biryani' },
      { name: 'Lucknowi Chicken Biryani', price: 340, isVeg: false, spicy: 1, prep: 28, description: 'Awadhi-style biryani, milder and floral, with rose-water finish.', category: 'lucknowi-biryani' },
      { name: 'Lucknowi Mutton Awadhi Biryani', price: 480, isVeg: false, spicy: 1, prep: 38, description: 'Royal Awadhi mutton biryani with delicate spices and slow-cooked goat.', category: 'lucknowi-biryani' },
      { name: 'Lucknowi Veg Biryani', price: 270, isVeg: true, spicy: 1, prep: 22, description: 'Mild, fragrant vegetable biryani in the Awadhi style with kewra.', category: 'lucknowi-biryani' },
      { name: 'Lucknowi Soya Biryani', price: 260, isVeg: true, spicy: 1, prep: 22, description: 'Marinated soya chunks in floral Awadhi-style basmati.', category: 'lucknowi-biryani' },
      { name: 'Galouti Kebab', price: 340, isVeg: false, spicy: 1, prep: 18, description: 'Melt-in-the-mouth minced mutton kebabs, Awadhi spice blend.', category: 'kebabs' },
      { name: 'Shami Kebab', price: 280, isVeg: false, spicy: 1, prep: 15, description: 'Bound mutton-and-chana kebabs, pan-seared crisp.', category: 'kebabs' },
      { name: 'Seekh Kebab', price: 300, isVeg: false, spicy: 2, prep: 18, description: 'Skewered minced lamb with green chilli and coriander.', category: 'kebabs' },
      { name: 'Tunday Kebab', price: 360, isVeg: false, spicy: 1, prep: 18, description: 'Iconic Lucknowi minced-meat kebab with 160 spices.', category: 'kebabs' },
      { name: 'Chicken Tikka', price: 320, isVeg: false, spicy: 2, prep: 18, description: 'Tandoor-charred chicken in yoghurt-spice marinade.', category: 'kebabs' },
      { name: 'Tangdi Kabab', price: 340, isVeg: false, spicy: 2, prep: 18, description: 'Bone-in chicken drumsticks, slow-grilled in masala marinade.', category: 'kebabs' },
      { name: 'Paneer Tikka', price: 280, isVeg: true, spicy: 1, prep: 15, description: 'Char-grilled paneer cubes with peppers and onions.', category: 'kebabs' },
      { name: 'Mughlai Murgh Korma', price: 360, isVeg: false, spicy: 1, prep: 22, description: 'Slow-cooked chicken in rich cashew-yoghurt gravy.', category: 'curries' },
      { name: 'Rogan Josh', price: 420, isVeg: false, spicy: 2, prep: 28, description: 'Kashmiri lamb stew in red-chilli and ginger-fennel gravy.', category: 'curries' },
      { name: 'Nihari', price: 460, isVeg: false, spicy: 2, prep: 30, description: 'Slow-cooked overnight lamb stew with bone marrow and aromatic spices.', category: 'curries' },
      { name: 'Dal Bukhara', price: 260, isVeg: true, spicy: 1, prep: 22, description: 'Black urad dal simmered overnight, finished with butter and cream.', category: 'curries' },
      { name: 'Mirchi Ka Salan', price: 220, isVeg: true, spicy: 3, prep: 18, description: 'Hyderabad-style chilli curry with peanut and sesame.', category: 'curries' },
      { name: 'Sheermal', price: 80, isVeg: true, spicy: 0, prep: 8, description: 'Saffron-tinted slightly-sweet flatbread from Awadh.', category: 'breads' },
      { name: 'Roghni Naan', price: 80, isVeg: true, spicy: 0, prep: 8, description: 'Soft naan brushed with milk, ghee and a sprinkle of sesame.', category: 'breads' },
      { name: 'Tandoori Roti', price: 40, isVeg: true, spicy: 0, prep: 6, description: 'Whole-wheat tandoor-baked roti.', category: 'breads' },
      { name: 'Butter Naan', price: 60, isVeg: true, spicy: 0, prep: 7, description: 'Tandoor-baked naan finished with a slick of butter.', category: 'breads' },
      { name: 'Jeera Rice', price: 180, isVeg: true, spicy: 0, prep: 12, description: 'Basmati tempered with cumin and ghee.', category: 'breads' },
      { name: 'Phirni', price: 130, isVeg: true, spicy: 0, prep: 5, description: 'Slow-cooked rice pudding with saffron and pistachio.', category: 'beverages' },
      { name: 'Sheer Khurma', price: 150, isVeg: true, spicy: 0, prep: 5, description: 'Sweet vermicelli pudding with dates and dry fruits.', category: 'beverages' },
      { name: 'Qubani Ka Meetha', price: 160, isVeg: true, spicy: 0, prep: 5, description: 'Hyderabadi stewed apricot dessert with cream.', category: 'beverages' },
      { name: 'Double Ka Meetha', price: 150, isVeg: true, spicy: 0, prep: 5, description: 'Hyderabad-style saffron-soaked bread pudding.', category: 'beverages' },
      { name: 'Sweet Lassi', price: 90, isVeg: true, spicy: 0, prep: 4, description: 'Thick yoghurt drink with sugar and a touch of rose.', category: 'beverages' },
      { name: 'Solkadhi', price: 80, isVeg: true, spicy: 1, prep: 4, description: 'Kokum-coconut milk cooler, palate cleanser.', category: 'beverages' },
      { name: 'Masala Chai', price: 50, isVeg: true, spicy: 0, prep: 4, description: 'Strong, spiced, lots of cardamom.', category: 'beverages' },
      { name: 'Rooh Afza Sharbat', price: 80, isVeg: true, spicy: 0, prep: 3, description: 'Chilled rose-syrup cooler.', category: 'beverages' },
      { name: 'Mineral Water', price: 30, isVeg: true, spicy: 0, prep: 1, description: 'Sealed 500ml bottle.', category: 'beverages' },
      { name: 'Cola', price: 60, isVeg: true, spicy: 0, prep: 1, description: 'Chilled.', category: 'beverages' }
    ],
    combos: [
      { name: 'Biryani for One', description: 'Hyderabadi Chicken Dum Biryani + Galouti Kebab + Sweet Lassi', items: [{ itemSlug: 'hyderabadi-chicken-dum-biryani', quantity: 1 }, { itemSlug: 'galouti-kebab', quantity: 1 }, { itemSlug: 'sweet-lassi', quantity: 1 }] },
      { name: 'Awadhi Royal Feast', description: 'Lucknowi Mutton Awadhi Biryani + Tunday Kebab + Phirni', items: [{ itemSlug: 'lucknowi-mutton-awadhi-biryani', quantity: 1 }, { itemSlug: 'tunday-kebab', quantity: 1 }, { itemSlug: 'phirni', quantity: 1 }] },
      { name: 'Veg Biryani Combo', description: 'Hyderabadi Veg Biryani + Paneer Tikka + Roghni Naan + Sweet Lassi', items: [{ itemSlug: 'hyderabadi-veg-biryani', quantity: 1 }, { itemSlug: 'paneer-tikka', quantity: 1 }, { itemSlug: 'roghni-naan', quantity: 1 }, { itemSlug: 'sweet-lassi', quantity: 1 }] }
    ],
    happyHour: { name: 'Lunch Biryani Hour', description: '15% off all biryanis 12-3pm.', startMin: 12 * 60, endMin: 15 * 60, percentOff: 15 }
  },

  // ── Bowl and Barbeque ───────────────────────────────────────────────────
  {
    slug: 'bowl-and-barbeque',
    name: 'Bowl and Barbeque',
    cuisine: 'Indian',
    tagline: 'Smoke. Spice. Slow-cooked perfection.',
    description:
      'Charcoal-grilled kebabs, smoky tandoor classics and signature grain bowls that put the barbeque on the table.',
    logoUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format&fit=crop&q=80',
    area: 'Lakshmipuram',
    city: 'Guntur',
    line1: 'Lakshmipuram Main Road',
    postalCode: '522007',
    latitude: 16.3120,
    longitude: 80.4290,
    categories: [
      { slug: 'starters', name: 'Starters' },
      { slug: 'soups', name: 'Soups' },
      { slug: 'grilled-bowls', name: 'Grilled Bowls' },
      { slug: 'main-course', name: 'Main Course' },
      { slug: 'live-counter', name: 'Live Counter' },
      { slug: 'desserts', name: 'Desserts' }
    ],
    items: [
      { name: 'Sigdi Chicken Tikka', price: 360, isVeg: false, spicy: 2, prep: 20, description: 'Coal-grilled chicken tikka with smoked yoghurt marinade.', category: 'starters' },
      { name: 'Reshmi Kebab', price: 340, isVeg: false, spicy: 1, prep: 18, description: 'Cream-marinated chicken skewers, silky and rich.', category: 'starters' },
      { name: 'Tandoori Pomfret', price: 520, isVeg: false, spicy: 2, prep: 22, description: 'Whole pomfret slathered in coastal masala and tandoor-charred.', category: 'starters' },
      { name: 'Smoky Paneer Tikka', price: 320, isVeg: true, spicy: 1, prep: 18, description: 'Charred paneer in dahi-spice marinade with bell peppers.', category: 'starters' },
      { name: 'Murgh Malai', price: 350, isVeg: false, spicy: 0, prep: 18, description: 'Cream-cheese chicken kebabs with mace and cardamom.', category: 'starters' },
      { name: 'Lasooni Mutton', price: 440, isVeg: false, spicy: 2, prep: 22, description: 'Garlic-marinated mutton chunks, slow-grilled.', category: 'starters' },
      { name: 'Burra Champ', price: 540, isVeg: false, spicy: 2, prep: 25, description: 'Bone-in mutton chops with a rich tandoori masala.', category: 'starters' },
      { name: 'Veg Galouti', price: 290, isVeg: true, spicy: 1, prep: 18, description: 'Melt-in-the-mouth raw-banana galouti kebab on mini-roomali.', category: 'starters' },
      { name: 'Tandoori Bharwan Aloo', price: 260, isVeg: true, spicy: 1, prep: 18, description: 'Stuffed baby potatoes in cashew-paneer masala, tandoor-charred.', category: 'starters' },
      { name: 'Grilled Bharwan Mushroom', price: 320, isVeg: true, spicy: 1, prep: 18, description: 'Stuffed button mushrooms with herbed cheese, tandoor-grilled.', category: 'starters' },
      { name: 'Chicken Hot & Sour Soup', price: 180, isVeg: false, spicy: 2, prep: 12, description: 'Pepper-forward chicken soup with mushrooms and shoots.', category: 'soups' },
      { name: 'Lemon Coriander Veg Soup', price: 160, isVeg: true, spicy: 1, prep: 10, description: 'Light, citrussy vegetable soup with fresh coriander.', category: 'soups' },
      { name: 'Smoked Cottage Cheese Bowl', price: 320, isVeg: true, spicy: 1, prep: 18, description: 'Charred paneer over jeera rice, peppers and tandoori sauce.', category: 'grilled-bowls' },
      { name: 'Murgh Achari Bowl', price: 360, isVeg: false, spicy: 2, prep: 20, description: 'Pickle-spiced chicken thighs over saffron pulao.', category: 'grilled-bowls' },
      { name: 'BBQ Pork Belly Bowl', price: 480, isVeg: false, spicy: 2, prep: 25, description: 'Slow-roasted pork belly, hoisin glaze, sticky rice.', category: 'grilled-bowls' },
      { name: 'Mediterranean Falafel Bowl', price: 320, isVeg: true, spicy: 1, prep: 18, description: 'Crispy falafel, hummus, tabbouleh and pickled veg.', category: 'grilled-bowls' },
      { name: 'Korean BBQ Beef Bowl', price: 520, isVeg: false, spicy: 2, prep: 22, description: 'Bulgogi-style beef, kimchi, sesame rice and gochujang.', category: 'grilled-bowls' },
      { name: 'Hummus Pita Platter', price: 280, isVeg: true, spicy: 0, prep: 10, description: 'Smooth tahini hummus with warm pita and olives.', category: 'main-course' },
      { name: 'Mezze Plate', price: 380, isVeg: true, spicy: 1, prep: 15, description: 'Tabbouleh, baba ganoush, hummus, pickles and pita.', category: 'main-course' },
      { name: 'Coal-Fired Veggies', price: 280, isVeg: true, spicy: 1, prep: 18, description: 'Smoky charred peppers, zucchini and corn, dressed in olive oil and chilli.', category: 'main-course' },
      { name: 'Smoked Dal Bukhara', price: 260, isVeg: true, spicy: 1, prep: 22, description: 'Black urad dal smoked with embers and finished with butter.', category: 'main-course' },
      { name: 'Tandoori Aloo Roomali', price: 240, isVeg: true, spicy: 1, prep: 15, description: 'Spiced tandoor aloo rolled in roomali roti with mint chutney.', category: 'main-course' },
      { name: 'Bhuna Mushroom Risotto', price: 360, isVeg: true, spicy: 1, prep: 22, description: 'Indo-Italian fusion risotto with bhuna mushroom masala.', category: 'main-course' },
      { name: 'Live Counter Dosa', price: 220, isVeg: true, spicy: 1, prep: 15, description: 'Made-to-order masala dosa with sambar and chutneys.', category: 'live-counter' },
      { name: 'Live Counter Chaat', price: 180, isVeg: true, spicy: 2, prep: 10, description: 'Crispy puri, chutneys and yoghurt assembled to order.', category: 'live-counter' },
      { name: 'Live Pasta Station', price: 320, isVeg: true, spicy: 1, prep: 18, description: 'Pick your pasta, sauce and toppings — tossed at the station.', category: 'live-counter' },
      { name: 'Mango Mastani', price: 180, isVeg: true, spicy: 0, prep: 5, description: 'Thick mango milkshake topped with ice cream and dry fruits.', category: 'desserts' },
      { name: 'Phirni', price: 160, isVeg: true, spicy: 0, prep: 5, description: 'Slow-cooked rice pudding, saffron, pistachio shards.', category: 'desserts' },
      { name: 'Coal-Cooked Brownie', price: 220, isVeg: true, spicy: 0, prep: 8, description: 'Warm fudge brownie smoked over embers, served with ice cream.', category: 'desserts' },
      { name: 'Chargrilled Pineapple', price: 180, isVeg: true, spicy: 0, prep: 8, description: 'Caramelised grilled pineapple with chilli sugar and lime.', category: 'desserts' }
    ],
    combos: [
      { name: 'Smokehouse Sampler', description: 'Sigdi Chicken Tikka + Reshmi Kebab + Smoked Dal Bukhara + Butter Naan', items: [{ itemSlug: 'sigdi-chicken-tikka', quantity: 1 }, { itemSlug: 'reshmi-kebab', quantity: 1 }, { itemSlug: 'smoked-dal-bukhara', quantity: 1 }, { itemSlug: 'tandoori-aloo-roomali', quantity: 1 }] },
      { name: 'Bowl Builder', description: 'Smoked Cottage Cheese Bowl + Lemon Coriander Soup + Coal-Cooked Brownie', items: [{ itemSlug: 'smoked-cottage-cheese-bowl', quantity: 1 }, { itemSlug: 'lemon-coriander-veg-soup', quantity: 1 }, { itemSlug: 'coal-cooked-brownie', quantity: 1 }] },
      { name: 'Veg Grill Feast', description: 'Smoky Paneer Tikka + Veg Galouti + Tandoori Bharwan Aloo + Phirni', items: [{ itemSlug: 'smoky-paneer-tikka', quantity: 1 }, { itemSlug: 'veg-galouti', quantity: 1 }, { itemSlug: 'tandoori-bharwan-aloo', quantity: 1 }, { itemSlug: 'phirni', quantity: 1 }] }
    ],
    happyHour: { name: 'Sundown Smokehouse', description: '15% off starters, 5-7pm.', startMin: 17 * 60, endMin: 19 * 60, percentOff: 15 }
  },

  // ── Hotel Siddhartha ────────────────────────────────────────────────────
  {
    slug: 'hotel-siddhartha',
    name: 'Hotel Siddhartha',
    cuisine: 'Multi-cuisine',
    tagline: 'Classic Indian comfort. Served warm since forever.',
    description:
      'A multi-cuisine veg-friendly classic — South Indian breakfasts, Indo-Chinese favourites, North Indian thalis, and the kind of chaat that turns a weekday around.',
    logoUrl: 'https://images.unsplash.com/photo-1567337710282-00832b415979?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1567337710282-00832b415979?w=1600&auto=format&fit=crop&q=80',
    area: 'Kothapet',
    city: 'Guntur',
    line1: 'Kothapet Bus Stand Road',
    postalCode: '522001',
    latitude: 16.2990,
    longitude: 80.4480,
    categories: [
      { slug: 'south-indian', name: 'South Indian' },
      { slug: 'indo-chinese', name: 'Indo-Chinese' },
      { slug: 'north-indian', name: 'North Indian' },
      { slug: 'chaat-snacks', name: 'Chaat & Snacks' },
      { slug: 'sweets', name: 'Sweets' },
      { slug: 'beverages', name: 'Beverages' }
    ],
    items: [
      { name: 'Masala Dosa', price: 140, isVeg: true, spicy: 1, prep: 12, description: 'Crisp dosa with spiced potato filling, chutneys and sambar.', category: 'south-indian' },
      { name: 'Mysore Masala Dosa', price: 160, isVeg: true, spicy: 2, prep: 12, description: 'Spicy red-chutney dosa with potato filling.', category: 'south-indian' },
      { name: 'Rava Dosa', price: 150, isVeg: true, spicy: 1, prep: 14, description: 'Crisp lace-thin semolina dosa with onions and ghee.', category: 'south-indian' },
      { name: 'Idli Vada Combo', price: 120, isVeg: true, spicy: 1, prep: 10, description: '2 idlis + 1 medu vada with sambar and three chutneys.', category: 'south-indian' },
      { name: 'Pongal', price: 130, isVeg: true, spicy: 1, prep: 12, description: 'Rice and moong-dal mash tempered with ghee, pepper and curry leaves.', category: 'south-indian' },
      { name: 'Upma', price: 120, isVeg: true, spicy: 1, prep: 10, description: 'Semolina cooked with veggies, mustard and curry leaves.', category: 'south-indian' },
      { name: 'Bisi Bele Bath', price: 160, isVeg: true, spicy: 2, prep: 15, description: 'Karnataka one-pot of rice, lentils, tamarind and ghee-fried cashews.', category: 'south-indian' },
      { name: 'Curd Rice', price: 130, isVeg: true, spicy: 0, prep: 8, description: 'Cooling curd rice with mustard tempering and pomegranate.', category: 'south-indian' },
      { name: 'Veg Hakka Noodles', price: 180, isVeg: true, spicy: 1, prep: 14, description: 'Wok-tossed Hakka noodles with crunchy veg and soy.', category: 'indo-chinese' },
      { name: 'Veg Manchurian (Gravy)', price: 200, isVeg: true, spicy: 2, prep: 14, description: 'Veg balls in tangy garlic-soy gravy.', category: 'indo-chinese' },
      { name: 'Schezwan Fried Rice', price: 200, isVeg: true, spicy: 2, prep: 14, description: 'Wok rice tossed in fiery schezwan paste.', category: 'indo-chinese' },
      { name: 'Chilli Paneer', price: 240, isVeg: true, spicy: 2, prep: 15, description: 'Crispy paneer cubes tossed in chilli-soy.', category: 'indo-chinese' },
      { name: 'Gobi 65', price: 200, isVeg: true, spicy: 2, prep: 12, description: 'Crispy cauliflower, fiery masala, curry leaves.', category: 'indo-chinese' },
      { name: 'Honey Chilli Potato', price: 200, isVeg: true, spicy: 2, prep: 12, description: 'Crispy potato tossed in honey-chilli glaze with sesame.', category: 'indo-chinese' },
      { name: 'Crispy Veg', price: 220, isVeg: true, spicy: 2, prep: 14, description: 'Mixed crunchy vegetables in spicy garlic sauce.', category: 'indo-chinese' },
      { name: 'Paneer Butter Masala', price: 260, isVeg: true, spicy: 1, prep: 18, description: 'Tomato-cashew gravy, soft paneer cubes, fenugreek aroma.', category: 'north-indian' },
      { name: 'Dal Makhani', price: 240, isVeg: true, spicy: 1, prep: 18, description: 'Black urad and rajma slow-simmered, finished with cream.', category: 'north-indian' },
      { name: 'Veg Biryani', price: 220, isVeg: true, spicy: 1, prep: 20, description: 'Mixed vegetables, whole spices, sealed and slow-cooked.', category: 'north-indian' },
      { name: 'Kashmiri Pulao', price: 240, isVeg: true, spicy: 0, prep: 18, description: 'Saffron pulao with dry fruits, paneer and pomegranate.', category: 'north-indian' },
      { name: 'Butter Naan', price: 60, isVeg: true, spicy: 0, prep: 7, description: 'Tandoor-baked, brushed with white butter.', category: 'north-indian' },
      { name: 'Tandoori Roti', price: 40, isVeg: true, spicy: 0, prep: 6, description: 'Whole-wheat roti from the tandoor.', category: 'north-indian' },
      { name: 'Pani Puri', price: 100, isVeg: true, spicy: 2, prep: 5, description: 'Crisp puris with spiced tamarind water and chickpea filling.', category: 'chaat-snacks' },
      { name: 'Bhel Puri', price: 120, isVeg: true, spicy: 1, prep: 5, description: 'Puffed rice with chutneys, sev and crunchy onion.', category: 'chaat-snacks' },
      { name: 'Sev Puri', price: 120, isVeg: true, spicy: 1, prep: 5, description: 'Crispy puris loaded with chutneys, onion and sev.', category: 'chaat-snacks' },
      { name: 'Dahi Puri', price: 130, isVeg: true, spicy: 1, prep: 5, description: 'Puris filled with chickpea, sweet yoghurt and chutneys.', category: 'chaat-snacks' },
      { name: 'Samosa Chaat', price: 150, isVeg: true, spicy: 2, prep: 10, description: 'Crushed samosa topped with chickpeas, yoghurt and chutneys.', category: 'chaat-snacks' },
      { name: 'Pav Bhaji', price: 180, isVeg: true, spicy: 2, prep: 15, description: 'Spiced veg mash with buttery soft pav.', category: 'chaat-snacks' },
      { name: 'Vada Pav', price: 80, isVeg: true, spicy: 2, prep: 8, description: 'Spicy potato fritter in pav with garlic chutney.', category: 'chaat-snacks' },
      { name: 'Misal Pav', price: 160, isVeg: true, spicy: 3, prep: 12, description: 'Sprouted moth-bean curry with farsan and onion.', category: 'chaat-snacks' },
      { name: 'Gulab Jamun (2 pc)', price: 100, isVeg: true, spicy: 0, prep: 5, description: 'Warm khoya dumplings in cardamom-rose syrup.', category: 'sweets' },
      { name: 'Rasmalai', price: 140, isVeg: true, spicy: 0, prep: 5, description: 'Soft cottage-cheese discs in saffron-cardamom milk.', category: 'sweets' },
      { name: 'Mysore Pak', price: 120, isVeg: true, spicy: 0, prep: 5, description: 'Classic ghee-rich besan fudge from Mysuru.', category: 'sweets' },
      { name: 'Carrot Halwa', price: 140, isVeg: true, spicy: 0, prep: 5, description: 'Slow-cooked carrot pudding with khoya and ghee.', category: 'sweets' },
      { name: 'Filter Coffee', price: 60, isVeg: true, spicy: 0, prep: 4, description: 'Traditional South Indian filter coffee, foamy and strong.', category: 'beverages' },
      { name: 'Madras Filter Kaapi', price: 70, isVeg: true, spicy: 0, prep: 4, description: 'Chicory-blend filter coffee in a tumbler-davara.', category: 'beverages' },
      { name: 'Badam Milk', price: 120, isVeg: true, spicy: 0, prep: 5, description: 'Saffron-almond milk, chilled or hot.', category: 'beverages' },
      { name: 'Masala Chai', price: 50, isVeg: true, spicy: 0, prep: 4, description: 'Strong, spiced, lots of cardamom.', category: 'beverages' },
      { name: 'Buttermilk', price: 60, isVeg: true, spicy: 1, prep: 3, description: 'Spiced chaas with ginger, curry leaves and asafoetida.', category: 'beverages' }
    ],
    combos: [
      { name: 'South Indian Breakfast', description: 'Masala Dosa + Idli Vada Combo + Filter Coffee', items: [{ itemSlug: 'masala-dosa', quantity: 1 }, { itemSlug: 'idli-vada-combo', quantity: 1 }, { itemSlug: 'filter-coffee', quantity: 1 }] },
      { name: 'Indo-Chinese Combo', description: 'Veg Hakka Noodles + Chilli Paneer + Cola', items: [{ itemSlug: 'veg-hakka-noodles', quantity: 1 }, { itemSlug: 'chilli-paneer', quantity: 1 }, { itemSlug: 'buttermilk', quantity: 1 }] },
      { name: 'Chaat Platter', description: 'Pani Puri + Sev Puri + Samosa Chaat + Masala Chai', items: [{ itemSlug: 'pani-puri', quantity: 1 }, { itemSlug: 'sev-puri', quantity: 1 }, { itemSlug: 'samosa-chaat', quantity: 1 }, { itemSlug: 'masala-chai', quantity: 1 }] }
    ],
    happyHour: { name: 'Tea-time Special', description: '10% off chaat & snacks 4-6pm.', startMin: 16 * 60, endMin: 18 * 60, percentOff: 10 }
  },

  // ── Wok and Sizzler ─────────────────────────────────────────────────────
  {
    slug: 'wok-and-sizzler',
    name: 'Wok and Sizzler',
    cuisine: 'Pan-Asian',
    tagline: 'Hot wok energy. Sizzling-plate delivery.',
    description:
      'Stir-fried noodles, hot-stone sizzlers, dimsum baskets and Thai curries — Pan-Asian small plates that arrive still crackling.',
    logoUrl: 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=1600&auto=format&fit=crop&q=80',
    area: 'Pattabhipuram',
    city: 'Guntur',
    line1: 'Pattabhipuram Main Road',
    postalCode: '522006',
    latitude: 16.3180,
    longitude: 80.4530,
    categories: [
      { slug: 'dimsum', name: 'Dimsum' },
      { slug: 'soups', name: 'Soups' },
      { slug: 'stir-fry', name: 'Stir Fry' },
      { slug: 'sizzlers', name: 'Sizzlers' },
      { slug: 'noodles-rice', name: 'Noodles & Rice' },
      { slug: 'desserts', name: 'Desserts' }
    ],
    items: [
      { name: 'Veg Dimsum (6 pc)', price: 240, isVeg: true, spicy: 1, prep: 14, description: 'Steamed wonton wrappers stuffed with mushroom, water-chestnut and ginger.', category: 'dimsum' },
      { name: 'Chicken Sui Mai (6 pc)', price: 280, isVeg: false, spicy: 1, prep: 14, description: 'Open-top chicken dumplings with prawn and bamboo shoot.', category: 'dimsum' },
      { name: 'Prawn Hargao (6 pc)', price: 360, isVeg: false, spicy: 1, prep: 14, description: 'Crystal-skin shrimp dumplings.', category: 'dimsum' },
      { name: 'Edamame Truffle Dumpling', price: 320, isVeg: true, spicy: 0, prep: 14, description: 'Edamame and truffle-oil dumplings in pleated wrappers.', category: 'dimsum' },
      { name: 'Spinach Mushroom Dumpling', price: 260, isVeg: true, spicy: 1, prep: 14, description: 'Wilted spinach and mushroom in a delicate green wrapper.', category: 'dimsum' },
      { name: 'Chicken Hot & Sour Soup', price: 220, isVeg: false, spicy: 2, prep: 12, description: 'Pepper-forward chicken soup with mushrooms and shoots.', category: 'soups' },
      { name: 'Tom Yum Soup', price: 240, isVeg: false, spicy: 3, prep: 14, description: 'Thai sour-spicy soup with prawn, lemongrass and galangal.', category: 'soups' },
      { name: 'Veg Hot Pot', price: 260, isVeg: true, spicy: 1, prep: 18, description: 'Steaming clay-pot of veg, tofu and udon in a clear broth.', category: 'soups' },
      { name: 'Burnt Garlic Fried Rice', price: 220, isVeg: true, spicy: 1, prep: 14, description: 'Wok rice with charred garlic and spring onion.', category: 'noodles-rice' },
      { name: 'Chicken Singapore Noodles', price: 260, isVeg: false, spicy: 2, prep: 14, description: 'Rice noodles tossed in curry-spice with chicken and peppers.', category: 'noodles-rice' },
      { name: 'Veg Hakka Noodles', price: 220, isVeg: true, spicy: 1, prep: 14, description: 'Wok-tossed Hakka noodles with crunchy veg and soy.', category: 'noodles-rice' },
      { name: 'Pad Thai', price: 280, isVeg: false, spicy: 2, prep: 16, description: 'Stir-fried rice noodles with prawn, peanut and tamarind.', category: 'noodles-rice' },
      { name: 'Vegetable Pho', price: 260, isVeg: true, spicy: 1, prep: 18, description: 'Vietnamese rice-noodle broth with herbs and lime.', category: 'noodles-rice' },
      { name: 'Mongolian Veg Sizzler', price: 360, isVeg: true, spicy: 2, prep: 18, description: 'Mongolian-style veg over rice on a sizzling plate.', category: 'sizzlers' },
      { name: 'Black Pepper Chicken Sizzler', price: 420, isVeg: false, spicy: 2, prep: 20, description: 'Pepper-glazed chicken with stir-fried veg and rice on a sizzler.', category: 'sizzlers' },
      { name: 'Shanghai Garlic Prawn Sizzler', price: 520, isVeg: false, spicy: 2, prep: 22, description: 'Wok-fired garlic prawns with udon noodles, sizzling.', category: 'sizzlers' },
      { name: 'Tofu Veg Sizzler', price: 340, isVeg: true, spicy: 1, prep: 18, description: 'Crispy tofu and seasonal veg in sesame-soy on a sizzler.', category: 'sizzlers' },
      { name: 'Kung Pao Chicken', price: 320, isVeg: false, spicy: 3, prep: 18, description: 'Wok-tossed chicken with peanuts and dried chillies.', category: 'stir-fry' },
      { name: 'Sweet & Sour Pork', price: 360, isVeg: false, spicy: 1, prep: 18, description: 'Crispy pork in tangy pineapple-tomato sauce.', category: 'stir-fry' },
      { name: 'Mapo Tofu', price: 280, isVeg: true, spicy: 3, prep: 18, description: 'Sichuan tofu in fermented bean and chilli sauce.', category: 'stir-fry' },
      { name: 'Chilli Garlic Tofu', price: 260, isVeg: true, spicy: 2, prep: 16, description: 'Stir-fried tofu in chilli-garlic glaze.', category: 'stir-fry' },
      { name: 'Crispy Honey Lotus Stem', price: 280, isVeg: true, spicy: 1, prep: 16, description: 'Lotus stem chips tossed in honey-chilli glaze.', category: 'stir-fry' },
      { name: 'Crispy Chilli Baby Corn', price: 240, isVeg: true, spicy: 2, prep: 14, description: 'Battered baby corn in chilli-soy.', category: 'stir-fry' },
      { name: 'Thai Red Curry (Veg)', price: 280, isVeg: true, spicy: 2, prep: 18, description: 'Coconut-milk red curry with bamboo shoots and basil.', category: 'stir-fry' },
      { name: 'Thai Green Curry (Chicken)', price: 320, isVeg: false, spicy: 2, prep: 18, description: 'Coconut-milk green curry with chicken and Thai basil.', category: 'stir-fry' },
      { name: 'Massaman Curry (Lamb)', price: 420, isVeg: false, spicy: 1, prep: 22, description: 'Slow-cooked lamb in massaman curry with potato and peanut.', category: 'stir-fry' },
      { name: 'Sticky Jasmine Rice', price: 120, isVeg: true, spicy: 0, prep: 10, description: 'Steamed jasmine rice.', category: 'noodles-rice' },
      { name: 'Coconut Sago', price: 180, isVeg: true, spicy: 0, prep: 6, description: 'Chilled coconut sago dessert with palm sugar.', category: 'desserts' },
      { name: 'Mango Sticky Rice', price: 220, isVeg: true, spicy: 0, prep: 8, description: 'Sweet sticky rice with mango and coconut cream.', category: 'desserts' },
      { name: 'Darsaan', price: 200, isVeg: true, spicy: 0, prep: 8, description: 'Honey-noodle dessert with vanilla ice cream.', category: 'desserts' }
    ],
    combos: [
      { name: 'Dimsum Date Night', description: 'Veg Dimsum + Chicken Sui Mai + Tom Yum Soup', items: [{ itemSlug: 'veg-dimsum-6-pc', quantity: 1 }, { itemSlug: 'chicken-sui-mai-6-pc', quantity: 1 }, { itemSlug: 'tom-yum-soup', quantity: 1 }] },
      { name: 'Sizzler Special', description: 'Black Pepper Chicken Sizzler + Veg Hot Pot + Mango Sticky Rice', items: [{ itemSlug: 'black-pepper-chicken-sizzler', quantity: 1 }, { itemSlug: 'veg-hot-pot', quantity: 1 }, { itemSlug: 'mango-sticky-rice', quantity: 1 }] },
      { name: 'Thai Combo', description: 'Thai Red Curry + Sticky Jasmine Rice + Coconut Sago', items: [{ itemSlug: 'thai-red-curry-veg', quantity: 1 }, { itemSlug: 'sticky-jasmine-rice', quantity: 1 }, { itemSlug: 'coconut-sago', quantity: 1 }] }
    ],
    happyHour: { name: 'Dimsum Hour', description: '20% off all dimsum, 4-6pm.', startMin: 16 * 60, endMin: 18 * 60, percentOff: 20 }
  },

  // ── Party Place ─────────────────────────────────────────────────────────
  {
    slug: 'party-place',
    name: 'Party Place',
    cuisine: 'Multi-cuisine',
    tagline: 'Crowd-sized portions. Celebration energy.',
    description:
      'Party trays, live counters and continental favourites designed for big tables and bigger occasions.',
    logoUrl: 'https://images.unsplash.com/photo-1555244162-803834f70033?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1555244162-803834f70033?w=1600&auto=format&fit=crop&q=80',
    area: 'Naaz Centre',
    city: 'Guntur',
    line1: 'Naaz Centre, Brodipet',
    postalCode: '522004',
    latitude: 16.3070,
    longitude: 80.4400,
    categories: [
      { slug: 'party-trays', name: 'Party Trays' },
      { slug: 'live-tandoor', name: 'Live Tandoor' },
      { slug: 'continental', name: 'Continental' },
      { slug: 'pasta-station', name: 'Pasta Station' },
      { slug: 'sweets-bar', name: 'Sweets Bar' },
      { slug: 'beverages', name: 'Beverages' }
    ],
    items: [
      { name: 'Mini Veg Trays (serves 6)', price: 640, isVeg: true, spicy: 1, prep: 25, description: 'Assorted veg starters tray — kebabs, tikkis and tandoor bites.', category: 'party-trays' },
      { name: 'Chicken Tikka Tray (serves 6)', price: 780, isVeg: false, spicy: 2, prep: 25, description: 'A platter of marinated chicken tikka for sharing.', category: 'party-trays' },
      { name: 'Paneer 65 Tray (serves 6)', price: 620, isVeg: true, spicy: 2, prep: 22, description: 'Crispy paneer 65 with curry-leaf garnish.', category: 'party-trays' },
      { name: 'Hara Bhara Kebab Tray (serves 6)', price: 580, isVeg: true, spicy: 1, prep: 20, description: 'Spinach-pea kebabs with mint chutney.', category: 'party-trays' },
      { name: 'Veg Pulao Tray (serves 8)', price: 720, isVeg: true, spicy: 1, prep: 25, description: 'Mildly spiced veg pulao for the party table.', category: 'party-trays' },
      { name: 'Tawa Pulao Tray (serves 8)', price: 780, isVeg: true, spicy: 2, prep: 25, description: 'Spicy Mumbai-style tawa pulao with pav-bhaji masala.', category: 'party-trays' },
      { name: 'Chicken Biryani Tray (serves 6)', price: 1050, isVeg: false, spicy: 2, prep: 35, description: 'Dum-cooked chicken biryani in a party tray.', category: 'party-trays' },
      { name: 'Mutton Biryani Tray (serves 6)', price: 1450, isVeg: false, spicy: 2, prep: 40, description: 'Hyderabadi mutton biryani sized for the party.', category: 'party-trays' },
      { name: 'Live Dosa Counter (per pax)', price: 220, isVeg: true, spicy: 1, prep: 18, description: 'Dosas made fresh at your venue counter.', category: 'live-tandoor' },
      { name: 'Live Tandoor Naan Counter (per pax)', price: 90, isVeg: true, spicy: 0, prep: 10, description: 'Hot naans pulled off the tandoor and served to your guests.', category: 'live-tandoor' },
      { name: 'Live Chaat Counter (per pax)', price: 180, isVeg: true, spicy: 2, prep: 12, description: 'Pani puri, sev puri and dahi puri assembled to order.', category: 'live-tandoor' },
      { name: 'Tandoori Chicken Live (per kg)', price: 720, isVeg: false, spicy: 2, prep: 28, description: 'Whole chicken tandoor-grilled at the counter.', category: 'live-tandoor' },
      { name: 'Tandoori Pomfret Live (per pc)', price: 540, isVeg: false, spicy: 2, prep: 25, description: 'Whole pomfret tandoor-finished at the counter.', category: 'live-tandoor' },
      { name: 'Continental Roast Chicken', price: 680, isVeg: false, spicy: 1, prep: 35, description: 'Herb-roasted whole chicken with mash and grilled veg.', category: 'continental' },
      { name: 'Grilled Fish Lemon Butter', price: 520, isVeg: false, spicy: 0, prep: 22, description: 'Pan-seared white fish with lemon-butter sauce.', category: 'continental' },
      { name: 'Mac & Cheese Tray', price: 580, isVeg: true, spicy: 0, prep: 22, description: 'Classic baked mac & cheese with breadcrumb crust.', category: 'continental' },
      { name: 'Veg Lasagne Tray', price: 620, isVeg: true, spicy: 0, prep: 28, description: 'Layered veg lasagne with bechamel and parmesan.', category: 'continental' },
      { name: 'Penne Arrabbiata Tray', price: 540, isVeg: true, spicy: 3, prep: 22, description: 'Spicy tomato-chilli pasta for the party.', category: 'pasta-station' },
      { name: 'Aglio Olio Tray', price: 520, isVeg: true, spicy: 2, prep: 22, description: 'Garlic-chilli pasta with parsley and parmesan.', category: 'pasta-station' },
      { name: 'Alfredo Pasta Tray', price: 580, isVeg: true, spicy: 0, prep: 22, description: 'Creamy parmesan alfredo with fettuccine.', category: 'pasta-station' },
      { name: 'Chocolate Brownie Tray (12 pc)', price: 540, isVeg: true, spicy: 0, prep: 8, description: 'Fudgy walnut brownies for the dessert table.', category: 'sweets-bar' },
      { name: 'Gulab Jamun Tray (24 pc)', price: 420, isVeg: true, spicy: 0, prep: 8, description: 'Warm gulab jamuns soaked in cardamom-rose syrup.', category: 'sweets-bar' },
      { name: 'Rasmalai Tray (12 pc)', price: 480, isVeg: true, spicy: 0, prep: 8, description: 'Saffron-rasmalai discs in chilled cardamom milk.', category: 'sweets-bar' },
      { name: 'Mini Tiramisu Cups (12 pc)', price: 540, isVeg: true, spicy: 0, prep: 8, description: 'Individual coffee-mascarpone cups for guests.', category: 'sweets-bar' },
      { name: 'Welcome Mocktail Jug (1.5L)', price: 380, isVeg: true, spicy: 0, prep: 8, description: 'Choice of virgin mojito, blue lagoon or sunrise.', category: 'beverages' },
      { name: 'Masala Chaas Jug (1.5L)', price: 280, isVeg: true, spicy: 1, prep: 8, description: 'Spiced buttermilk jug for the party.', category: 'beverages' },
      { name: 'Aam Panna Jug (1.5L)', price: 320, isVeg: true, spicy: 1, prep: 8, description: 'Raw-mango cooler with mint and roasted cumin.', category: 'beverages' },
      { name: 'Cola (2L)', price: 220, isVeg: true, spicy: 0, prep: 2, description: 'Chilled 2-litre bottle.', category: 'beverages' }
    ],
    combos: [
      { name: 'Office Party Pack (10 pax)', description: 'Veg Tray + Chicken Tikka Tray + Veg Pulao Tray + Brownie Tray', items: [{ itemSlug: 'mini-veg-trays-serves-6', quantity: 1 }, { itemSlug: 'chicken-tikka-tray-serves-6', quantity: 1 }, { itemSlug: 'veg-pulao-tray-serves-8', quantity: 1 }, { itemSlug: 'chocolate-brownie-tray-12-pc', quantity: 1 }] },
      { name: 'Family Function Combo', description: 'Mutton Biryani Tray + Paneer 65 Tray + Naan Counter + Gulab Jamun Tray', items: [{ itemSlug: 'mutton-biryani-tray-serves-6', quantity: 1 }, { itemSlug: 'paneer-65-tray-serves-6', quantity: 1 }, { itemSlug: 'live-tandoor-naan-counter-per-pax', quantity: 10 }, { itemSlug: 'gulab-jamun-tray-24-pc', quantity: 1 }] },
      { name: 'Birthday Bash Combo', description: 'Continental Roast Chicken + Mac & Cheese Tray + Mini Tiramisu Cups + Welcome Mocktail Jug', items: [{ itemSlug: 'continental-roast-chicken', quantity: 1 }, { itemSlug: 'mac-and-cheese-tray', quantity: 1 }, { itemSlug: 'mini-tiramisu-cups-12-pc', quantity: 1 }, { itemSlug: 'welcome-mocktail-jug-1-5l', quantity: 1 }] }
    ],
    happyHour: { name: 'Early Bird Party Pricing', description: '10% off party trays before noon.', startMin: 10 * 60, endMin: 12 * 60, percentOff: 10 }
  },

  // ── Cuisine of Andhra ───────────────────────────────────────────────────
  {
    slug: 'cuisine-of-andhra',
    name: 'Cuisine of Andhra',
    cuisine: 'Andhra',
    tagline: 'Andhra mirchi. Coastal soul. Pure heat.',
    description:
      'Andhra-style spicy curries, ghee-rice meals, gunpowder dosas and the kind of pickles that make a meal a memory.',
    logoUrl: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&auto=format&fit=crop&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=1600&auto=format&fit=crop&q=80',
    area: 'Sri Nagar Colony',
    city: 'Guntur',
    line1: 'Sri Nagar Colony, Guntur',
    postalCode: '522006',
    latitude: 16.2950,
    longitude: 80.4470,
    categories: [
      { slug: 'andhra-meals', name: 'Andhra Meals' },
      { slug: 'veg-curries', name: 'Veg Curries' },
      { slug: 'non-veg-curries', name: 'Non-veg Curries' },
      { slug: 'pickles-sides', name: 'Pickles & Sides' },
      { slug: 'tiffins', name: 'Tiffins' },
      { slug: 'sweets', name: 'Sweets' }
    ],
    items: [
      { name: 'Andhra Veg Thali', price: 280, isVeg: true, spicy: 3, prep: 15, description: 'Steamed rice, sambar, rasam, two veg curries, pappu, pickle and curd.', category: 'andhra-meals' },
      { name: 'Andhra Non-Veg Thali', price: 380, isVeg: false, spicy: 3, prep: 18, description: 'Steamed rice, chicken curry, rasam, pappu, pickle, papad and curd.', category: 'andhra-meals' },
      { name: 'Bagara Annam', price: 160, isVeg: true, spicy: 0, prep: 12, description: 'Mildly-spiced ghee rice with whole spices and ghee fried onions.', category: 'andhra-meals' },
      { name: 'Andhra Mutton Biryani', price: 420, isVeg: false, spicy: 3, prep: 30, description: 'Fiery Andhra-style mutton biryani with green-chilli paste.', category: 'andhra-meals' },
      { name: 'Hyderabadi Veg Biryani', price: 260, isVeg: true, spicy: 2, prep: 22, description: 'Dum-cooked veg biryani in the neighbouring style.', category: 'andhra-meals' },
      { name: 'Pulihora', price: 160, isVeg: true, spicy: 2, prep: 12, description: 'Tamarind rice with peanuts and curry leaves.', category: 'andhra-meals' },
      { name: 'Curd Rice', price: 130, isVeg: true, spicy: 0, prep: 8, description: 'Mustard-tempered curd rice with pomegranate.', category: 'andhra-meals' },
      { name: 'Gongura Mutton', price: 460, isVeg: false, spicy: 3, prep: 30, description: 'Tangy sorrel-leaf mutton — the signature Andhra dish.', category: 'non-veg-curries' },
      { name: 'Andhra Chicken Curry', price: 320, isVeg: false, spicy: 3, prep: 22, description: 'Spicy curry with curry leaves, red chillies and mustard tempering.', category: 'non-veg-curries' },
      { name: 'Kodi Vepudu', price: 340, isVeg: false, spicy: 3, prep: 25, description: 'Andhra-style dry chicken fry with curry leaves and pepper.', category: 'non-veg-curries' },
      { name: 'Royyala Iguru', price: 460, isVeg: false, spicy: 3, prep: 25, description: 'Slow-cooked prawn curry with onion-tomato base.', category: 'non-veg-curries' },
      { name: 'Chepala Pulusu', price: 420, isVeg: false, spicy: 3, prep: 25, description: 'Tamarind-tomato fish curry, coastal Andhra style.', category: 'non-veg-curries' },
      { name: 'Chicken Chettinad', price: 340, isVeg: false, spicy: 3, prep: 25, description: 'Chettinad-spiced chicken with roasted coconut and pepper.', category: 'non-veg-curries' },
      { name: 'Gongura Pappu', price: 220, isVeg: true, spicy: 2, prep: 18, description: 'Toor dal cooked with tangy gongura (sorrel) leaves.', category: 'veg-curries' },
      { name: 'Mudda Pappu', price: 180, isVeg: true, spicy: 1, prep: 15, description: 'Plain toor dal pressed soft, served with ghee.', category: 'veg-curries' },
      { name: 'Ulavacharu', price: 220, isVeg: true, spicy: 2, prep: 18, description: 'Horse-gram broth, Andhra speciality.', category: 'veg-curries' },
      { name: 'Gutti Vankaya', price: 240, isVeg: true, spicy: 3, prep: 22, description: 'Stuffed baby brinjals in a roasted-peanut masala.', category: 'veg-curries' },
      { name: 'Drumstick Sambar', price: 200, isVeg: true, spicy: 2, prep: 18, description: 'Traditional drumstick sambar with toor dal.', category: 'veg-curries' },
      { name: 'Rasam', price: 120, isVeg: true, spicy: 2, prep: 12, description: 'Peppery tamarind-tomato broth.', category: 'veg-curries' },
      { name: 'Avakaya Pickle (side)', price: 80, isVeg: true, spicy: 3, prep: 2, description: 'Classic Andhra raw-mango pickle.', category: 'pickles-sides' },
      { name: 'Tomato Pachadi (side)', price: 80, isVeg: true, spicy: 2, prep: 2, description: 'Andhra tomato chutney with mustard tempering.', category: 'pickles-sides' },
      { name: 'Gongura Pachadi (side)', price: 90, isVeg: true, spicy: 3, prep: 2, description: 'Sorrel-leaf chutney, tangy and fiery.', category: 'pickles-sides' },
      { name: 'Andhra Style Sambar', price: 180, isVeg: true, spicy: 2, prep: 18, description: 'Spicier Andhra-style sambar with extra red chilli.', category: 'pickles-sides' },
      { name: 'Pesarattu', price: 140, isVeg: true, spicy: 1, prep: 14, description: 'Green-gram dosa served with ginger chutney.', category: 'tiffins' },
      { name: 'Pesarattu Upma', price: 180, isVeg: true, spicy: 1, prep: 18, description: 'Pesarattu with upma stuffing — MLA pesarattu.', category: 'tiffins' },
      { name: 'Punugulu', price: 120, isVeg: true, spicy: 1, prep: 10, description: 'Crispy deep-fried dosa-batter fritters.', category: 'tiffins' },
      { name: 'Mirchi Bajji', price: 130, isVeg: true, spicy: 3, prep: 10, description: 'Stuffed green chilli fritters in chickpea batter.', category: 'tiffins' },
      { name: 'Idli Karam Podi', price: 130, isVeg: true, spicy: 2, prep: 10, description: 'Soft idlis served with gunpowder and ghee.', category: 'tiffins' },
      { name: 'Bobbatlu (Boorelu)', price: 160, isVeg: true, spicy: 0, prep: 12, description: 'Sweet flatbread with jaggery-coconut filling.', category: 'sweets' },
      { name: 'Pootharekulu', price: 200, isVeg: true, spicy: 0, prep: 8, description: 'Andhra rice-paper sweet with ghee and powdered sugar.', category: 'sweets' },
      { name: 'Junnu', price: 140, isVeg: true, spicy: 0, prep: 8, description: 'Sweet colostrum-milk pudding with cardamom.', category: 'sweets' },
      { name: 'Bellam Paramannam', price: 160, isVeg: true, spicy: 0, prep: 10, description: 'Jaggery rice pudding with cashews and ghee.', category: 'sweets' },
      { name: 'Filter Coffee', price: 60, isVeg: true, spicy: 0, prep: 4, description: 'Traditional South Indian filter coffee.', category: 'sweets' },
      { name: 'Buttermilk (Majjiga)', price: 60, isVeg: true, spicy: 1, prep: 3, description: 'Spiced chaas with ginger and curry leaves.', category: 'sweets' },
      { name: 'Sweet Lassi', price: 90, isVeg: true, spicy: 0, prep: 4, description: 'Thick yoghurt drink with sugar and rose.', category: 'sweets' }
    ],
    combos: [
      { name: 'Andhra Lunch Special', description: 'Andhra Veg Thali + Gongura Pappu + Buttermilk', items: [{ itemSlug: 'andhra-veg-thali', quantity: 1 }, { itemSlug: 'gongura-pappu', quantity: 1 }, { itemSlug: 'buttermilk-majjiga', quantity: 1 }] },
      { name: 'Coastal Combo', description: 'Andhra Mutton Biryani + Royyala Iguru + Pootharekulu', items: [{ itemSlug: 'andhra-mutton-biryani', quantity: 1 }, { itemSlug: 'royyala-iguru', quantity: 1 }, { itemSlug: 'pootharekulu', quantity: 1 }] },
      { name: 'Andhra Tiffin Combo', description: 'Pesarattu + Punugulu + Filter Coffee', items: [{ itemSlug: 'pesarattu', quantity: 1 }, { itemSlug: 'punugulu', quantity: 1 }, { itemSlug: 'filter-coffee', quantity: 1 }] }
    ],
    happyHour: { name: 'Andhra Meals Hour', description: '10% off thalis 12-3pm.', startMin: 12 * 60, endMin: 15 * 60, percentOff: 10 }
  }
];

// ─── seed runners ─────────────────────────────────────────────────────────

const ADMIN_PASSWORD = 'Admin@12345';
const KITCHEN_PASSWORD = 'Kitchen@12345';

interface SeededCounts {
  itemCount: number;
  comboCount: number;
  orderCount: number;
}

const credentials: { email: string; password: string; role: string }[] = [];
const restaurantSummaries: { name: string; slug: string; itemCount: number; comboCount: number }[] = [];

async function ensureBrand() {
  // Migrate legacy slug if present.
  const legacy = await (prisma as any).brand.findUnique({ where: { slug: 'maverick-hospitality' } });
  if (legacy) {
    return (prisma as any).brand.update({
      where: { id: legacy.id },
      data: {
        slug: 'group-of-cuisines',
        name: 'Group of Cuisines',
        tagline: 'Seven kitchens. One umbrella. Every craving.',
        description:
          'A multi-cuisine hospitality group running seven distinct restaurant concepts under a single operations roof.',
        logoUrl: BRAND_LOGO,
        coverImageUrl: BRAND_COVER,
        contactEmail: 'hello@groupofcuisines.example',
        contactPhone: '+919900112233',
        status: RestaurantStatus.ACTIVE
      }
    });
  }

  return (prisma as any).brand.upsert({
    where: { slug: 'group-of-cuisines' },
    update: {
      name: 'Group of Cuisines',
      tagline: 'Seven kitchens. One umbrella. Every craving.',
      description:
        'A multi-cuisine hospitality group running seven distinct restaurant concepts under a single operations roof.',
      logoUrl: BRAND_LOGO,
      coverImageUrl: BRAND_COVER,
      contactEmail: 'hello@groupofcuisines.example',
      contactPhone: '+919900112233',
      status: RestaurantStatus.ACTIVE
    },
    create: {
      slug: 'group-of-cuisines',
      name: 'Group of Cuisines',
      tagline: 'Seven kitchens. One umbrella. Every craving.',
      description:
        'A multi-cuisine hospitality group running seven distinct restaurant concepts under a single operations roof.',
      logoUrl: BRAND_LOGO,
      coverImageUrl: BRAND_COVER,
      contactEmail: 'hello@groupofcuisines.example',
      contactPhone: '+919900112233',
      status: RestaurantStatus.ACTIVE
    }
  });
}

async function ensureUser(opts: { email?: string; phone?: string; name: string; role: Role; passwordHash?: string }): Promise<{ id: string }> {
  if (opts.email) {
    return prisma.user.upsert({
      where: { email: opts.email },
      update: { name: opts.name, role: opts.role, ...(opts.passwordHash ? { passwordHash: opts.passwordHash } : {}) },
      create: {
        email: opts.email,
        name: opts.name,
        role: opts.role,
        ...(opts.passwordHash ? { passwordHash: opts.passwordHash } : {}),
        ...(opts.phone ? { phone: opts.phone } : {})
      }
    });
  }
  if (opts.phone) {
    return prisma.user.upsert({
      where: { phone: opts.phone },
      update: { name: opts.name, role: opts.role },
      create: { phone: opts.phone, name: opts.name, role: opts.role }
    });
  }
  throw new Error('ensureUser requires email or phone');
}

async function seedCuisine(c: CuisineSeed, brandId: string, adminPass: string, kitchenPass: string): Promise<SeededCounts> {
  // ── Admin user (the restaurant owner) ──────────────────────────────────
  // shortened email handle e.g. admin@italia-pizza.maverickfoodhub.com (we
  // keep the maverickfoodhub.com domain so existing credential screenshots
  // remain plausible — only the friendly brand name changed).
  const adminEmail = `admin@${c.slug}.maverickfoodhub.com`;
  const kitchenEmail = `kitchen@${c.slug}.maverickfoodhub.com`;

  const admin = await ensureUser({
    email: adminEmail,
    name: `${c.name} Owner`,
    role: Role.ADMIN,
    passwordHash: adminPass
  });
  credentials.push({ email: adminEmail, password: ADMIN_PASSWORD, role: 'ADMIN' });

  // ── Restaurant ─────────────────────────────────────────────────────────
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: c.slug },
    update: {
      name: c.name,
      tagline: c.tagline,
      description: c.description,
      cuisine: c.cuisine,
      logoUrl: c.logoUrl,
      coverImageUrl: c.coverImageUrl,
      status: RestaurantStatus.ACTIVE,
      approvedAt: new Date(),
      ownerUserId: admin.id,
      brandId,
      commissionPct: 15
    } as any,
    create: {
      slug: c.slug,
      name: c.name,
      tagline: c.tagline,
      description: c.description,
      cuisine: c.cuisine,
      logoUrl: c.logoUrl,
      coverImageUrl: c.coverImageUrl,
      status: RestaurantStatus.ACTIVE,
      approvedAt: new Date(),
      ownerUserId: admin.id,
      brandId,
      commissionPct: 15
    } as any
  });

  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant.id, userId: admin.id } },
    update: { role: Role.ADMIN },
    create: { restaurantId: restaurant.id, userId: admin.id, role: Role.ADMIN }
  });

  // ── Branch ─────────────────────────────────────────────────────────────
  const branchSlug = `${c.slug}-main`;
  const branch = await prisma.branch.upsert({
    where: { slug: branchSlug },
    update: {
      restaurantId: restaurant.id,
      name: `${c.name} — ${c.area}`,
      line1: c.line1,
      city: c.city,
      state: 'AP',
      postalCode: c.postalCode,
      country: 'IN',
      latitude: c.latitude,
      longitude: c.longitude,
      serviceRadiusKm: 7,
      taxRatePct: 5,
      baseDeliveryFee: 40 as any,
      perKmDeliveryFee: 8 as any,
      isActive: true
    },
    create: {
      restaurantId: restaurant.id,
      name: `${c.name} — ${c.area}`,
      slug: branchSlug,
      line1: c.line1,
      city: c.city,
      state: 'AP',
      postalCode: c.postalCode,
      country: 'IN',
      latitude: c.latitude,
      longitude: c.longitude,
      serviceRadiusKm: 7,
      taxRatePct: 5,
      baseDeliveryFee: 40 as any,
      perKmDeliveryFee: 8 as any,
      isActive: true,
      hours: {
        create: Array.from({ length: 7 }).map((_, i) => ({
          dayOfWeek: i,
          openMin: 10 * 60,
          closeMin: 23 * 60
        }))
      }
    }
  });

  // ── Kitchen user (BranchUser scoped) ───────────────────────────────────
  const kitchen = await ensureUser({
    email: kitchenEmail,
    name: `${c.name} Kitchen`,
    role: Role.KITCHEN,
    passwordHash: kitchenPass
  });
  credentials.push({ email: kitchenEmail, password: KITCHEN_PASSWORD, role: 'KITCHEN' });

  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant.id, userId: kitchen.id } },
    update: { role: Role.KITCHEN },
    create: { restaurantId: restaurant.id, userId: kitchen.id, role: Role.KITCHEN }
  });
  await prisma.branchUser.upsert({
    where: { branchId_userId: { branchId: branch.id, userId: kitchen.id } },
    update: { role: Role.KITCHEN },
    create: { branchId: branch.id, userId: kitchen.id, role: Role.KITCHEN }
  });

  // ── Categories ─────────────────────────────────────────────────────────
  const categoryIdBySlug: Record<string, string> = {};
  for (let i = 0; i < c.categories.length; i++) {
    const cat = c.categories[i];
    const row = await prisma.category.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: cat.slug } },
      update: { name: cat.name, sortOrder: i, isActive: true },
      create: { branchId: branch.id, slug: cat.slug, name: cat.name, sortOrder: i, isActive: true }
    });
    categoryIdBySlug[cat.slug] = row.id;
  }

  // ── MenuItems ──────────────────────────────────────────────────────────
  const menuItemIdBySlug: Record<string, string> = {};
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i];
    const itemSlug = slugify(it.name);
    const categoryId = categoryIdBySlug[it.category];
    if (!categoryId) throw new Error(`Missing category '${it.category}' for item '${it.name}' in ${c.slug}`);
    const row = await prisma.menuItem.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: itemSlug } },
      update: {
        name: it.name,
        description: it.description,
        price: it.price as any,
        isVeg: it.isVeg,
        spicyLevel: it.spicy ?? 0,
        prepTimeMin: it.prep ?? 20,
        imageUrl: it.image ?? FALLBACK_FOOD_IMAGE,
        isAvailable: true,
        categoryId,
        sortOrder: i
      },
      create: {
        branchId: branch.id,
        categoryId,
        name: it.name,
        slug: itemSlug,
        description: it.description,
        price: it.price as any,
        isVeg: it.isVeg,
        spicyLevel: it.spicy ?? 0,
        prepTimeMin: it.prep ?? 20,
        imageUrl: it.image ?? FALLBACK_FOOD_IMAGE,
        isAvailable: true,
        sortOrder: i
      }
    });
    menuItemIdBySlug[itemSlug] = row.id;
  }

  // ── Combos ─────────────────────────────────────────────────────────────
  for (let i = 0; i < c.combos.length; i++) {
    const combo = c.combos[i];
    const comboSlug = slugify(combo.name);
    const resolvedItems = combo.items
      .map((ci) => {
        const id = menuItemIdBySlug[ci.itemSlug];
        if (!id) {
          console.warn(`  ! combo ${comboSlug} references missing item slug ${ci.itemSlug} — skipped`);
          return null;
        }
        return { id, quantity: ci.quantity, slug: ci.itemSlug };
      })
      .filter((x): x is { id: string; quantity: number; slug: string } => x !== null);
    if (resolvedItems.length === 0) continue;

    // Compute reference total = sum(price * qty) then apply ~15% off, round to 10.
    const itemsBySlug = new Map(c.items.map((x) => [slugify(x.name), x]));
    const regularSum = resolvedItems.reduce((s, ri) => {
      const p = itemsBySlug.get(ri.slug)?.price ?? 0;
      return s + p * ri.quantity;
    }, 0);
    const comboPrice = Math.max(50, Math.round((regularSum * 0.85) / 10) * 10);

    const created = await prisma.combo.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: comboSlug } },
      update: {
        name: combo.name,
        description: combo.description,
        price: comboPrice as any,
        isAvailable: true,
        sortOrder: i
      },
      create: {
        branchId: branch.id,
        slug: comboSlug,
        name: combo.name,
        description: combo.description,
        price: comboPrice as any,
        isAvailable: true,
        sortOrder: i
      }
    });

    // Replace combo items idempotently — clear and re-create.
    await prisma.comboItem.deleteMany({ where: { comboId: created.id } });
    for (const ri of resolvedItems) {
      await prisma.comboItem.create({
        data: { comboId: created.id, menuItemId: ri.id, quantity: ri.quantity }
      });
    }
  }

  // ── Customers ──────────────────────────────────────────────────────────
  const phoneSuffix = digitsOf(c.slug, 6);
  const customer1Phone = `+91987${phoneSuffix[0]}${phoneSuffix.slice(1, 7).padStart(6, '1')}`.slice(0, 13);
  // Build phones deterministically and uniquely per restaurant.
  const phoneA = `+919870${phoneSuffix.slice(0, 6)}`;
  const phoneB = `+919871${phoneSuffix.slice(0, 6)}`;

  const customer1 = await prisma.user.upsert({
    where: { phone: phoneA },
    update: { role: Role.CUSTOMER, name: `${c.name} Patron A` },
    create: {
      role: Role.CUSTOMER,
      name: `${c.name} Patron A`,
      phone: phoneA,
      addresses: {
        create: {
          label: 'Home',
          line1: `${c.area} home address`,
          city: c.city,
          state: 'AP',
          postalCode: c.postalCode,
          latitude: c.latitude + 0.005,
          longitude: c.longitude + 0.005,
          isDefault: true
        }
      }
    }
  });

  const customer2 = await prisma.user.upsert({
    where: { phone: phoneB },
    update: { role: Role.CUSTOMER, name: `${c.name} Patron B` },
    create: {
      role: Role.CUSTOMER,
      name: `${c.name} Patron B`,
      phone: phoneB,
      addresses: {
        create: {
          label: 'Office',
          line1: `${c.area} office address`,
          city: c.city,
          state: 'AP',
          postalCode: c.postalCode,
          latitude: c.latitude - 0.005,
          longitude: c.longitude - 0.005,
          isDefault: true
        }
      }
    }
  });

  // Make sure each customer has at least one address (re-runs without
  // change above don't re-trigger nested create, but the original create
  // already attached one).
  const customer1Address = await prisma.address.findFirst({ where: { userId: customer1.id } });
  if (!customer1Address) {
    await prisma.address.create({
      data: {
        userId: customer1.id,
        label: 'Home',
        line1: `${c.area} home address`,
        city: c.city,
        state: 'AP',
        postalCode: c.postalCode,
        latitude: c.latitude + 0.005,
        longitude: c.longitude + 0.005,
        isDefault: true
      }
    });
  }

  // ── Riders (3 per restaurant) + KYC ────────────────────────────────────
  const riderUserIds: string[] = [];
  for (let r = 0; r < 3; r++) {
    const riderPhone = `+91987${5 + r}${phoneSuffix.slice(0, 6)}`;
    const riderUser = await prisma.user.upsert({
      where: { phone: riderPhone },
      update: { role: Role.RIDER, name: `${c.name} Rider ${r + 1}` },
      create: { role: Role.RIDER, name: `${c.name} Rider ${r + 1}`, phone: riderPhone }
    });
    riderUserIds.push(riderUser.id);

    const vehicleType = r === 0 ? 'BIKE' : r === 1 ? 'SCOOTER' : 'BIKE';
    // Build a plausible AP-registered vehicle number, e.g. "AP-16-AB-1234"
    const seriesSeed = digitsOf(`${c.slug}-rider${r}`, 4);
    const letters = ['AB', 'CD', 'EF', 'GH', 'JK', 'LM', 'NP'];
    const letter = letters[(r + c.slug.length) % letters.length];
    const vehicleNumber = `AP-16-${letter}-${seriesSeed}`;

    const profile = await prisma.riderProfile.upsert({
      where: { userId: riderUser.id },
      update: {
        branchId: branch.id,
        vehicleType,
        vehicleNumber,
        approvedAt: new Date(),
        isOnline: r === 0
      },
      create: {
        userId: riderUser.id,
        branchId: branch.id,
        vehicleType,
        vehicleNumber,
        approvedAt: new Date(),
        isOnline: r === 0
      }
    });

    const kycDocs = [
      { type: 'AADHAAR' as const, last4: '1234' },
      { type: 'DRIVING_LICENSE' as const, last4: '5678' },
      { type: 'VEHICLE_INSURANCE' as const, last4: '9012' }
    ];
    for (const doc of kycDocs) {
      await (prisma as any).riderKycDocument.upsert({
        where: { riderId_type: { riderId: profile.id, type: doc.type } },
        update: { status: 'APPROVED', numberLast4: doc.last4, fileUrl: `https://cdn.example/kyc/${profile.id}/${doc.type}.jpg` },
        create: {
          riderId: profile.id,
          type: doc.type,
          status: 'APPROVED',
          numberLast4: doc.last4,
          fileUrl: `https://cdn.example/kyc/${profile.id}/${doc.type}.jpg`,
          submittedAt: new Date()
        }
      });
    }
  }

  // ── Offers ─────────────────────────────────────────────────────────────
  const pctOfferName = `${c.name} 20% Off`;
  const codeOfferName = `${c.name} Welcome ₹50`;
  const codeStr = `WELCOME50-${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;

  // Find-or-create — Offer doesn't have a unique name+restaurantId column,
  // so we do findFirst-then-upsert-by-id (or create) ourselves.
  const existingPctOffer = await (prisma as any).offer.findFirst({
    where: { restaurantId: restaurant.id, name: pctOfferName }
  });
  if (existingPctOffer) {
    await (prisma as any).offer.update({
      where: { id: existingPctOffer.id },
      data: {
        description: 'Get 20% off your order, max ₹100',
        type: 'PERCENTAGE',
        percentOff: 20,
        maxDiscount: 100 as any,
        autoApply: true,
        priority: 50,
        isActive: true,
        validFrom: new Date(),
        validTo: null
      }
    });
  } else {
    await (prisma as any).offer.create({
      data: {
        name: pctOfferName,
        description: 'Get 20% off your order, max ₹100',
        type: 'PERCENTAGE',
        percentOff: 20,
        maxDiscount: 100 as any,
        autoApply: true,
        priority: 50,
        restaurantId: restaurant.id,
        isActive: true,
        validFrom: new Date(),
        minCustomerOrders: 0
      }
    });
  }

  // FIXED ₹50 off with a code.
  const existingCodeOffer = await (prisma as any).offer.findFirst({ where: { code: codeStr } });
  if (existingCodeOffer) {
    await (prisma as any).offer.update({
      where: { id: existingCodeOffer.id },
      data: {
        name: codeOfferName,
        description: 'Use code for ₹50 off',
        type: 'FIXED',
        flatOff: 50 as any,
        minOrderAmount: 250 as any,
        priority: 30,
        autoApply: false,
        restaurantId: restaurant.id,
        isActive: true,
        validFrom: new Date(),
        validTo: null
      }
    });
  } else {
    await (prisma as any).offer.create({
      data: {
        name: codeOfferName,
        description: 'Use code for ₹50 off',
        type: 'FIXED',
        code: codeStr,
        flatOff: 50 as any,
        minOrderAmount: 250 as any,
        priority: 30,
        autoApply: false,
        restaurantId: restaurant.id,
        isActive: true,
        validFrom: new Date()
      }
    });
  }

  // ── HappyHourRule + 7 day schedule ─────────────────────────────────────
  const existingHH = await (prisma as any).happyHourRule.findFirst({
    where: { restaurantId: restaurant.id, name: c.happyHour.name }
  });
  let happyHourId: string;
  if (existingHH) {
    happyHourId = existingHH.id;
    await (prisma as any).happyHourRule.update({
      where: { id: existingHH.id },
      data: {
        description: c.happyHour.description,
        scope: 'RESTAURANT',
        discountType: 'PERCENTAGE',
        percentOff: c.happyHour.percentOff,
        isActive: true,
        priority: 10,
        validFrom: new Date(),
        validTo: null
      }
    });
    await (prisma as any).happyHourSchedule.deleteMany({ where: { ruleId: existingHH.id } });
  } else {
    const created = await (prisma as any).happyHourRule.create({
      data: {
        restaurantId: restaurant.id,
        name: c.happyHour.name,
        description: c.happyHour.description,
        scope: 'RESTAURANT',
        discountType: 'PERCENTAGE',
        percentOff: c.happyHour.percentOff,
        isActive: true,
        priority: 10,
        validFrom: new Date()
      }
    });
    happyHourId = created.id;
  }
  for (let d = 0; d < 7; d++) {
    await (prisma as any).happyHourSchedule.create({
      data: {
        ruleId: happyHourId,
        dayOfWeek: d,
        startMin: c.happyHour.startMin,
        endMin: c.happyHour.endMin
      }
    });
  }

  // ── Sample Orders ──────────────────────────────────────────────────────
  // Pick a handful of items to base orders on (the first six items).
  const sampleItems = c.items.slice(0, 6).map((it) => ({
    ...it,
    slug: slugify(it.name),
    id: menuItemIdBySlug[slugify(it.name)]
  }));

  const orderSpecs: { suffix: string; status: OrderStatus; daysAgo: number; payment: PaymentMethod; itemCount: number; cancelled?: boolean }[] = [
    { suffix: '01', status: OrderStatus.DELIVERED, daysAgo: 13, payment: PaymentMethod.RAZORPAY, itemCount: 2 },
    { suffix: '02', status: OrderStatus.DELIVERED, daysAgo: 10, payment: PaymentMethod.COD, itemCount: 3 },
    { suffix: '03', status: OrderStatus.DELIVERED, daysAgo: 7, payment: PaymentMethod.RAZORPAY, itemCount: 2 },
    { suffix: '04', status: OrderStatus.DELIVERED, daysAgo: 4, payment: PaymentMethod.RAZORPAY, itemCount: 1 },
    { suffix: '05', status: OrderStatus.OUT_FOR_DELIVERY, daysAgo: 0, payment: PaymentMethod.RAZORPAY, itemCount: 2 },
    { suffix: '06', status: OrderStatus.READY, daysAgo: 0, payment: PaymentMethod.COD, itemCount: 2 },
    { suffix: '07', status: OrderStatus.PREPARING, daysAgo: 0, payment: PaymentMethod.RAZORPAY, itemCount: 2 },
    { suffix: '08', status: OrderStatus.CANCELLED_BY_CUSTOMER, daysAgo: 2, payment: PaymentMethod.RAZORPAY, itemCount: 1, cancelled: true }
  ];

  let orderCount = 0;
  for (let oi = 0; oi < orderSpecs.length; oi++) {
    const spec = orderSpecs[oi];
    const code = `ORD-GOC-${c.slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}-${spec.suffix}`;
    const existing = await prisma.order.findUnique({ where: { code } });
    if (existing) { orderCount++; continue; }

    // Choose deterministic items (avoid empty if there are fewer than itemCount).
    const picks: typeof sampleItems = [];
    for (let k = 0; k < spec.itemCount; k++) picks.push(sampleItems[(oi + k) % sampleItems.length]);

    const subtotal = picks.reduce((s, p) => s + p.price, 0);
    const tax = +(subtotal * 0.05).toFixed(2);
    const fee = 40;
    const discount = spec.status === OrderStatus.DELIVERED && (oi % 3 === 0) ? Math.min(100, +(subtotal * 0.1).toFixed(2)) : 0;
    const total = +(subtotal + tax + fee - discount).toFixed(2);
    const placedAt = new Date(Date.now() - spec.daysAgo * 24 * 60 * 60_000 - oi * 30 * 60_000);

    const customer = oi % 2 === 0 ? customer1 : customer2;
    const address = await prisma.address.findFirst({ where: { userId: customer.id } });

    const isPostAccept = ![OrderStatus.RECEIVED].includes(spec.status as any);
    const isPrepOrLater = [OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED].includes(spec.status as any);
    const isReadyOrLater = [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED].includes(spec.status as any);
    const isOfdOrLater = [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED].includes(spec.status as any);
    const isDelivered = spec.status === OrderStatus.DELIVERED;

    await prisma.order.create({
      data: {
        code,
        branchId: branch.id,
        customerId: customer.id,
        addressId: address?.id,
        status: spec.status,
        subtotal: subtotal as any,
        taxAmount: tax as any,
        deliveryFee: fee as any,
        discountAmount: discount as any,
        total: total as any,
        paymentMethod: spec.payment,
        placedAt,
        acceptedAt: !spec.cancelled && isPostAccept ? new Date(placedAt.getTime() + 60_000) : null,
        preparingAt: !spec.cancelled && isPrepOrLater ? new Date(placedAt.getTime() + 90_000) : null,
        readyAt: !spec.cancelled && isReadyOrLater ? new Date(placedAt.getTime() + 18 * 60_000) : null,
        outForDeliveryAt: !spec.cancelled && isOfdOrLater ? new Date(placedAt.getTime() + 22 * 60_000) : null,
        deliveredAt: isDelivered ? new Date(placedAt.getTime() + 38 * 60_000) : null,
        cancelledAt: spec.cancelled ? new Date(placedAt.getTime() + 10 * 60_000) : null,
        cancellationReason: spec.cancelled ? CancellationReason.CUSTOMER_CHANGED_MIND : null,
        cancelledBy: spec.cancelled ? customer.id : null,
        deliveryOtp: isOfdOrLater ? '4242' : null,
        items: {
          create: picks.map((p) => ({
            menuItemId: p.id,
            name: p.name,
            quantity: 1,
            unitPrice: p.price as any
          }))
        }
      }
    });
    orderCount++;
  }

  return {
    itemCount: c.items.length,
    comboCount: c.combos.length,
    orderCount
  };
}

async function main() {
  console.log('▶︎ Seeding Group of Cuisines …');

  const adminPass = await argon2.hash(ADMIN_PASSWORD);
  const kitchenPass = await argon2.hash(KITCHEN_PASSWORD);

  const brand = await ensureBrand();
  console.log(`  brand          : ok (slug=${brand.slug}, id=${brand.id})`);

  let totalItems = 0;
  let totalCombos = 0;
  let totalOrders = 0;

  for (const c of CUISINES) {
    const counts = await seedCuisine(c, brand.id, adminPass, kitchenPass);
    totalItems += counts.itemCount;
    totalCombos += counts.comboCount;
    totalOrders += counts.orderCount;
    restaurantSummaries.push({
      name: c.name,
      slug: c.slug,
      itemCount: counts.itemCount,
      comboCount: counts.comboCount
    });
    console.log(`  cuisine        : ${c.name.padEnd(22)} — ${counts.itemCount} items, ${counts.comboCount} combos, ${counts.orderCount} orders`);
  }

  // ── Summary box ────────────────────────────────────────────────────────
  console.log('');
  console.log('✅ Group of Cuisines seeded');
  console.log('   Brand: group-of-cuisines');
  console.log('');
  console.log('   Restaurants:');
  restaurantSummaries.forEach((r, i) => {
    console.log(
      `     ${(i + 1).toString().padStart(2)}. ${r.name.padEnd(22)} — /r/${r.slug.padEnd(22)} — ${r.itemCount} items, ${r.comboCount} combos`
    );
  });
  console.log('');
  console.log(`   Totals: ${restaurantSummaries.length} restaurants, ${totalItems} items, ${totalCombos} combos, ${totalOrders} orders`);
  console.log('');
  console.log('   Login credentials (copy & store):');
  for (const cred of credentials) {
    console.log(`     [${cred.role.padEnd(8)}] ${cred.email.padEnd(48)} / ${cred.password}`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('✘ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
