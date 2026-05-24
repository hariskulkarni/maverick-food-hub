import 'server-only';
import { prisma } from '@/server/db';
import { filterNearbyRestaurants, type DeliveryLocation } from '@/server/discovery';
import { imageFor } from '@/lib/food-images';
import {
  itemMatchesCategory,
  dishKey,
  type DiscoveryCategory
} from '@/lib/discovery-categories';

/**
 * Cross-restaurant dish discovery.
 *
 * Powers the "What's on your mind?" category pages: given a discovery category
 * (a curated keyword bundle — see lib/discovery-categories.ts) it scans the
 * menus of nearby ACTIVE restaurants, finds matching dishes, and aggregates
 * them two ways:
 *   • a deduped dish grid (distinct dish names + how many restaurants serve it),
 *   • for a selected dish, the list of restaurants serving it (nearest-first).
 *
 * All matching is config-driven over the existing per-restaurant menus — no
 * global taxonomy / DB migration required. With a delivery location set we only
 * consider deliverable branches; without one we consider all ACTIVE restaurants.
 */

export type VegFilter = 'veg' | 'nonveg' | null;

export type CategoryDish = {
  /** Normalised dedupe key (also the ?dish= query value). */
  key: string;
  /** Display name (first occurrence). */
  name: string;
  /** Best image we could resolve (may be '' → caller falls back). */
  image: string;
  minPrice: number;
  /** True if ANY matching variant of this dish is vegetarian. */
  isVeg: boolean;
  restaurantCount: number;
};

export type DishRestaurant = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  cuisine: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  distanceM: number | null;
  /** Cheapest matching item price at this restaurant. */
  price: number;
  itemName: string;
  image: string;
  isVeg: boolean;
};

export type CategoryOffer = {
  id: string;
  name: string;
  type: string;
  code: string | null;
  percentOff: number | null;
  flatOff: number | null;
};

type MatchedItem = {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    cuisine: string | null;
    coverImageUrl: string | null;
    logoUrl: string | null;
  };
  distanceM: number | null;
  item: { name: string; slug: string; imageUrl: string | null; price: number; isVeg: boolean };
};

/** Resolve the best image for a matched item (item photo → curated slug map). */
function itemImage(item: { imageUrl: string | null; slug: string }): string {
  return item.imageUrl || imageFor(item.slug, '') || '';
}

/**
 * Core scan: every available menu item (in nearby/deliverable branches) that
 * matches the category, annotated with its restaurant + distance.
 */
async function collectMatches(
  category: DiscoveryCategory,
  loc: DeliveryLocation | null,
  radiusKm: number,
  veg: VegFilter
): Promise<MatchedItem[]> {
  const active = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      cuisine: true,
      coverImageUrl: true,
      logoUrl: true,
      branches: {
        select: {
          id: true,
          latitude: true,
          longitude: true,
          serviceRadiusKm: true,
          categories: {
            where: { isActive: true },
            select: {
              name: true,
              menuItems: {
                where: { isAvailable: true },
                select: { name: true, slug: true, imageUrl: true, price: true, isVeg: true }
              }
            }
          }
        }
      }
    }
  });

  // Scope to deliverable branches when a location is set; otherwise all.
  const scoped = loc
    ? filterNearbyRestaurants(loc, radiusKm, active).map((m) => ({
        r: m.restaurant,
        distanceM: m.distanceM as number | null,
        branchId: m.branchId
      }))
    : active.map((r) => ({ r, distanceM: null as number | null, branchId: r.branches[0]?.id ?? null }));

  const out: MatchedItem[] = [];
  for (const s of scoped) {
    const branch = s.r.branches.find((b) => b.id === s.branchId) ?? s.r.branches[0];
    if (!branch) continue;
    for (const cat of branch.categories) {
      for (const it of cat.menuItems) {
        if (!itemMatchesCategory(category, it.name, cat.name)) continue;
        if (veg === 'veg' && !it.isVeg) continue;
        if (veg === 'nonveg' && it.isVeg) continue;
        out.push({
          restaurant: {
            id: s.r.id,
            slug: s.r.slug,
            name: s.r.name,
            tagline: s.r.tagline,
            cuisine: s.r.cuisine,
            coverImageUrl: s.r.coverImageUrl,
            logoUrl: s.r.logoUrl
          },
          distanceM: s.distanceM,
          item: {
            name: it.name,
            slug: it.slug,
            imageUrl: it.imageUrl,
            price: Number(it.price),
            isVeg: it.isVeg
          }
        });
      }
    }
  }
  return out;
}

/** Active platform/restaurant offers whose name/desc mentions this category. */
async function categoryOffers(category: DiscoveryCategory): Promise<CategoryOffer[]> {
  const now = new Date();
  const raw = await (prisma as any).offer
    .findMany({
      where: { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 40
    })
    .catch(() => []);
  return (raw as any[])
    .filter((o) => {
      const hay = `${o.name ?? ''} ${o.description ?? ''}`.toLowerCase();
      return category.match.some((m) => hay.includes(m));
    })
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      code: o.code ?? null,
      percentOff: o.percentOff ?? null,
      flatOff: o.flatOff != null ? Number(o.flatOff) : null
    }));
}

export type CategoryView = {
  dishes: CategoryDish[];
  restaurantCount: number;
  offers: CategoryOffer[];
};

/** Landing view: deduped dish grid + restaurant count + relevant offers. */
export async function getCategoryView(
  category: DiscoveryCategory,
  loc: DeliveryLocation | null,
  radiusKm: number,
  veg: VegFilter
): Promise<CategoryView> {
  const [matches, offers] = await Promise.all([
    collectMatches(category, loc, radiusKm, veg),
    categoryOffers(category)
  ]);

  const map = new Map<
    string,
    { name: string; image: string; minPrice: number; isVeg: boolean; restaurants: Set<string> }
  >();
  for (const m of matches) {
    const key = dishKey(m.item.name);
    if (!key) continue;
    const image = itemImage(m.item);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        name: m.item.name,
        image,
        minPrice: m.item.price,
        isVeg: m.item.isVeg,
        restaurants: new Set([m.restaurant.id])
      });
    } else {
      cur.minPrice = Math.min(cur.minPrice, m.item.price);
      cur.isVeg = cur.isVeg || m.item.isVeg;
      if (!cur.image && image) cur.image = image;
      cur.restaurants.add(m.restaurant.id);
    }
  }

  const dishes: CategoryDish[] = [...map.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      image: v.image,
      minPrice: v.minPrice,
      isVeg: v.isVeg,
      restaurantCount: v.restaurants.size
    }))
    .sort((a, b) => b.restaurantCount - a.restaurantCount || a.minPrice - b.minPrice || a.name.localeCompare(b.name));

  const restaurantCount = new Set(matches.map((m) => m.restaurant.id)).size;
  return { dishes, restaurantCount, offers };
}

/** Dish-selected view: restaurants serving the chosen dish, nearest-first. */
export async function getDishRestaurants(
  category: DiscoveryCategory,
  selectedDishKey: string,
  loc: DeliveryLocation | null,
  radiusKm: number,
  veg: VegFilter
): Promise<{ dishName: string; restaurants: DishRestaurant[] }> {
  const matches = await collectMatches(category, loc, radiusKm, veg);
  const rows: DishRestaurant[] = [];
  let dishName = '';
  for (const m of matches) {
    if (dishKey(m.item.name) !== selectedDishKey) continue;
    if (!dishName) dishName = m.item.name;
    const existing = rows.find((r) => r.id === m.restaurant.id);
    if (existing) {
      if (m.item.price < existing.price) {
        existing.price = m.item.price;
        existing.itemName = m.item.name;
        if (!existing.image) existing.image = itemImage(m.item);
      }
      continue;
    }
    rows.push({
      ...m.restaurant,
      distanceM: m.distanceM,
      price: m.item.price,
      itemName: m.item.name,
      image: itemImage(m.item),
      isVeg: m.item.isVeg
    });
  }
  rows.sort(
    (a, b) => (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER) || a.price - b.price
  );
  return { dishName, restaurants: rows };
}
