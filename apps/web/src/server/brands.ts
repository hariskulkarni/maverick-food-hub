/**
 * Brand (umbrella) reporting + browsing helpers.
 *
 *   getBrandBySlug(slug)              → brand + its cuisine concepts (Restaurant rows)
 *                                        + a thin Branch[] for each cuisine so the
 *                                        customer-facing landing can show
 *                                        "5 dishes from 3 branches" per cuisine.
 *
 *   getBrandSalesRollup(brandId, range)
 *                                     → { brand, cuisine[], branch[], item[] } rolled
 *                                        up from completed orders inside the range.
 *                                        Pure-ish: takes prisma indirectly via a
 *                                        single set of grouped queries.
 *
 *   sumByRestaurant / sumByBranch / sumByItem
 *                                     → pure helpers that fold a single Order[]
 *                                        into per-key totals. Exported so tests can
 *                                        exercise the math without DB.
 *
 * Reports return both ₹ revenue and order count so the dashboard can switch
 * between "Top 5 cuisines by revenue" and "Top 5 cuisines by order volume"
 * without two server round-trips.
 *
 * Tenancy / channel:
 *   - Cancelled and failed-payment orders are excluded from sums (matches the
 *     /platform/analytics convention).
 *   - Tip and refund deltas are ignored at this level — those are reported
 *     separately in the existing super-admin analytics screen.
 *   - For "shared kitchen" branches, an order belongs to whichever
 *     `Order.branchId` it was placed against. We do NOT double-count.
 */
import { prisma } from './db';
import { clampTwo } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrandWithCuisines {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  cuisines: {
    id: string;
    slug: string;
    name: string;
    cuisine: string | null;
    tagline: string | null;
    description: string | null;
    logoUrl: string | null;
    coverImageUrl: string | null;
    status: string;
    branchCount: number;
    primaryCity: string | null;
    dishCount: number;
  }[];
}

export interface BrandReportRange { from: Date; to: Date }

export interface BrandReportRow {
  key: string;
  label: string;
  revenue: number;
  orders: number;
}
export interface BrandReportResult {
  brand: { revenue: number; orders: number };
  cuisine: BrandReportRow[];
  branch: BrandReportRow[];
  item: BrandReportRow[];
  range: { from: string; to: string };
}

// ── Loaders ────────────────────────────────────────────────────────────────

export async function getBrandBySlug(slug: string): Promise<BrandWithCuisines | null> {
  const brand = await (prisma as any).brand.findUnique({
    where: { slug },
    include: {
      restaurants: {
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        include: {
          branches: {
            where: { isActive: true },
            select: { id: true, city: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      }
    }
  });
  if (!brand) return null;

  // Count dishes per cuisine in one shot so the landing page doesn't N+1 on hover.
  const restaurantIds = brand.restaurants.map((r: any) => r.id);
  const branchIds = brand.restaurants.flatMap((r: any) => r.branches.map((b: any) => b.id));
  const dishCounts = branchIds.length === 0
    ? new Map<string, number>()
    : new Map((await prisma.menuItem.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, isAvailable: true },
        _count: { _all: true }
      })).map((r) => [r.branchId, r._count._all]));

  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    tagline: brand.tagline ?? null,
    description: brand.description ?? null,
    logoUrl: brand.logoUrl ?? null,
    coverImageUrl: brand.coverImageUrl ?? null,
    contactEmail: brand.contactEmail ?? null,
    contactPhone: brand.contactPhone ?? null,
    status: brand.status,
    cuisines: brand.restaurants.map((r: any) => {
      const branchCount = r.branches.length;
      const primaryCity = r.branches[0]?.city ?? null;
      const dishCount = r.branches.reduce((s: number, b: any) => s + (dishCounts.get(b.id) ?? 0), 0);
      return {
        id: r.id, slug: r.slug, name: r.name,
        cuisine: r.cuisine ?? null, tagline: r.tagline ?? null,
        description: r.description ?? null,
        logoUrl: r.logoUrl ?? null, coverImageUrl: r.coverImageUrl ?? null,
        status: r.status,
        branchCount, primaryCity, dishCount
      };
    })
  };
}

// ── Pure aggregators (tested separately so reports stay trustworthy) ───────

export interface OrderRowForSum {
  id: string;
  branchId: string;
  restaurantId: string;
  total: number;
}
export interface OrderItemRowForSum {
  orderId: string;
  menuItemId: string | null;
  comboId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export function sumByRestaurant(orders: OrderRowForSum[]): Map<string, { revenue: number; orders: number }> {
  const m = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    const cur = m.get(o.restaurantId) ?? { revenue: 0, orders: 0 };
    cur.revenue = clampTwo(cur.revenue + o.total);
    cur.orders += 1;
    m.set(o.restaurantId, cur);
  }
  return m;
}

export function sumByBranch(orders: OrderRowForSum[]): Map<string, { revenue: number; orders: number }> {
  const m = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    const cur = m.get(o.branchId) ?? { revenue: 0, orders: 0 };
    cur.revenue = clampTwo(cur.revenue + o.total);
    cur.orders += 1;
    m.set(o.branchId, cur);
  }
  return m;
}

/**
 * Item-level rollup keys on `menuItemId` when present else `comboId` else the
 * literal item name (snapshot in OrderItem.name). Quantity-weighted revenue
 * uses (unitPrice × quantity), matching how `pricing.subtotal` is computed
 * upstream — this is the cleanest stand-in for "per-item revenue" without
 * needing to re-derive each order's discount allocation.
 */
export function sumByItem(items: OrderItemRowForSum[]): Map<string, { label: string; revenue: number; orders: number }> {
  const m = new Map<string, { label: string; revenue: number; orders: number }>();
  const seenPair = new Set<string>(); // (key, orderId) so an item ordered twice in one order doesn't double the order count
  for (const it of items) {
    const key = it.menuItemId ?? it.comboId ?? `name:${it.name}`;
    const cur = m.get(key) ?? { label: it.name, revenue: 0, orders: 0 };
    cur.revenue = clampTwo(cur.revenue + it.unitPrice * it.quantity);
    const pair = `${key}::${it.orderId}`;
    if (!seenPair.has(pair)) {
      cur.orders += 1;
      seenPair.add(pair);
    }
    m.set(key, cur);
  }
  return m;
}

// ── DB-aware rollup ───────────────────────────────────────────────────────

export async function getBrandSalesRollup(brandId: string, range: BrandReportRange): Promise<BrandReportResult> {
  // 1. All cuisines under this brand.
  const cuisines = await prisma.restaurant.findMany({
    where: { brandId },
    select: { id: true, name: true, branches: { select: { id: true, name: true } } }
  });
  const restaurantIds = cuisines.map((r) => r.id);
  const branchById = new Map(cuisines.flatMap((r) => r.branches.map((b) => [b.id, b.name])));

  if (restaurantIds.length === 0) {
    return {
      brand: { revenue: 0, orders: 0 },
      cuisine: [], branch: [], item: [],
      range: { from: range.from.toISOString(), to: range.to.toISOString() }
    };
  }

  // 2. Orders in range, excluding cancellations/failed payments.
  const orders = await prisma.order.findMany({
    where: {
      branch: { restaurantId: { in: restaurantIds } },
      placedAt: { gte: range.from, lt: range.to },
      status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN', 'REFUNDED'] }
    },
    include: { items: true, branch: { select: { restaurantId: true } } }
  });

  const flatOrders: OrderRowForSum[] = orders.map((o) => ({
    id: o.id,
    branchId: o.branchId,
    restaurantId: o.branch.restaurantId,
    total: Number(o.total)
  }));
  const flatItems: OrderItemRowForSum[] = orders.flatMap((o) => o.items.map((it) => ({
    orderId: o.id,
    menuItemId: it.menuItemId,
    comboId: it.comboId,
    name: it.name,
    quantity: it.quantity,
    unitPrice: Number(it.unitPrice)
  })));

  // 3. Fold into the three buckets.
  const perCuisine = sumByRestaurant(flatOrders);
  const perBranch  = sumByBranch(flatOrders);
  const perItem    = sumByItem(flatItems);

  const cuisineLabel = new Map(cuisines.map((r) => [r.id, r.name]));

  return {
    brand: {
      revenue: clampTwo(flatOrders.reduce((s, o) => s + o.total, 0)),
      orders: flatOrders.length
    },
    cuisine: Array.from(perCuisine.entries()).map(([id, v]) => ({
      key: id, label: cuisineLabel.get(id) ?? '(unknown)',
      revenue: v.revenue, orders: v.orders
    })).sort((a, b) => b.revenue - a.revenue),
    branch: Array.from(perBranch.entries()).map(([id, v]) => ({
      key: id, label: branchById.get(id) ?? '(unknown)',
      revenue: v.revenue, orders: v.orders
    })).sort((a, b) => b.revenue - a.revenue),
    item: Array.from(perItem.entries()).map(([key, v]) => ({
      key, label: v.label, revenue: v.revenue, orders: v.orders
    })).sort((a, b) => b.revenue - a.revenue),
    range: { from: range.from.toISOString(), to: range.to.toISOString() }
  };
}

// ── Slug helper ───────────────────────────────────────────────────────────

/** Generate a URL-safe slug from a brand or cuisine name. Lowercase, dashes,
 *  alphanumeric only; trims leading/trailing dashes. */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
