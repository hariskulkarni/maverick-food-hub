/**
 * Shared data loader for the marketing homepage (`/r/[slug]`) and the ordering
 * page (`/r/[slug]/menu`). Both routes hit the same underlying restaurant +
 * branch + menu state, so we centralise the prisma calls here to avoid the
 * (expensive + drift-prone) duplication that would happen if each page did
 * its own loads.
 *
 * Returns one fat object containing everything either page might want to
 * render — pages cherry-pick the fields they need. Uses `notFound()` from
 * next/navigation for the bad-restaurant / no-branch case so both pages
 * inherit the same 404 behaviour.
 */
import { notFound } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { bannersForSlug } from '@/lib/storefront-banners';
import { FOOD_FALLBACK } from '@/lib/food-images';
import {
  parseStorefrontConfig,
  themeStyleVars,
  type StorefrontConfig
} from '@/server/storefront-cms';
import {
  loadRulesForRestaurant,
  minutesUntilHappyHourEnds
} from '@/server/happy-hours';
import {
  isCategoryAvailableNow,
  formatNextOpenLabel
} from '@/server/category-availability';
import { isBranchOpenAt, type BranchOpenStatus } from '@/server/operating-hours';
import type { CategoryFabEntry } from './category-fab';

// Inline result type — readable enough; callers destructure what they need.
export interface RestaurantPageData {
  // Loaded prisma rows (kept as any because the Prisma client is intentionally
  // stale around the newer brand/dineIn/fssai columns elsewhere in the codebase
  // — see existing `as any` casts in page.tsx).
  restaurant: any;
  branch: any;

  // Storefront CMS
  cms: StorefrontConfig;
  themeVars: React.CSSProperties;

  // Hero
  heroSlides: Array<{ src: string; headline?: string; subtext?: string; ctaLabel?: string; ctaHref?: string }>;
  heroImage: string;

  // Brand ribbon
  siblingCuisineCount: number;

  // Happy hour
  happyHourRules: Awaited<ReturnType<typeof loadRulesForRestaurant>>;
  happyHourEnds: ReturnType<typeof minutesUntilHappyHourEnds>;

  // Offers
  activeOffers: any[];

  // Menu
  categories: any[];
  combos: any[];
  topSellers: any[];
  fabCategories: CategoryFabEntry[];

  // Auth + favorites
  favRestaurant: { userId: string; restaurantId: string } | null;
  favItemSet: Set<string>;
  isAuthed: boolean;

  // Derived display state
  rating: string;
  ratingValue: string | null;
  ratingCount: number;
  isVerified: boolean;
  dishCount: number;
  now: Date;

  /**
   * Whether the branch is currently inside its operating hours.
   * Used by the storefront to render the closed banner, grey out the menu,
   * and force checkout into scheduled-order mode.
   */
  openStatus: BranchOpenStatus;
}

export async function loadRestaurantPageData(slug: string): Promise<RestaurantPageData> {
  // Include the umbrella brand (slug + name) so we can render the "Part of …"
  // ribbon without a second round-trip. `brand` is nullable — most restaurants
  // are solo and have no brandId set.
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: { brand: { select: { slug: true, name: true } } }
  } as any) as any;
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  // Count the brand's other active cuisines (excluding the current one) so
  // the ribbon can say "explore 5 sister cuisines". Skipped when no brand.
  const siblingCuisineCount: number = restaurant.brandId
    ? await prisma.restaurant.count({
        where: {
          brandId: restaurant.brandId,
          status: 'ACTIVE',
          id: { not: restaurant.id }
        } as any
      })
    : 0;

  // include: { hours } so we can compute the open/closed status without a
  // second round-trip. Hours come back as OperatingHours[] (7 rows max).
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    include: { hours: { orderBy: { dayOfWeek: 'asc' } } } as any,
  } as any) as any;
  if (!branch) return notFound();

  const now = new Date();
  // Branch operating-hours status. If the branch has no rows configured we
  // treat it as always-open (consistent with the resolver's legacy default).
  const openStatus = isBranchOpenAt((branch.hours ?? []) as any, now);
  // Happy-hour rules currently active for this restaurant.
  const happyHourRules = await loadRulesForRestaurant(restaurant.id, now);
  const happyHourEnds = minutesUntilHappyHourEnds(happyHourRules, now);
  // Active offers for this restaurant — platform-wide (restaurantId NULL) OR
  // scoped to this restaurant.
  const activeOffers = await (prisma as any).offer.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      AND: [{ OR: [{ restaurantId: null }, { restaurantId: restaurant.id }] }]
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 12
  });

  const [categories, combos, topSellers] = await Promise.all([
    prisma.category.findMany({
      where: { branchId: branch.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: { isAvailable: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            variants: { orderBy: { sortOrder: 'asc' } },
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              include: { options: { orderBy: { sortOrder: 'asc' } } }
            }
          }
        },
        availabilities: true
      }
    }),
    prisma.combo.findMany({
      where: { branchId: branch.id, isAvailable: true },
      orderBy: { sortOrder: 'asc' },
      include: { items: { include: { menuItem: true } } }
    }),
    // Top sellers: 4 most-ordered menu items in the past 30 days for this branch
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      _sum: { quantity: true },
      where: {
        menuItemId: { not: null },
        order: {
          branchId: branch.id,
          status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] },
          placedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }
        }
      },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 4
    }).then(async (rows) => {
      const items = await prisma.menuItem.findMany({
        where: { id: { in: rows.map((r) => r.menuItemId!).filter(Boolean) } }
      });
      return rows
        .map((r) => ({ ...items.find((i) => i.id === r.menuItemId)!, soldCount: r._sum.quantity ?? 0 }))
        .filter((x) => x?.id);
    })
  ]);

  // Auth + favorites
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isAuthed = Boolean(userId);
  const [favRestaurant, favItemRows] = await Promise.all([
    userId
      ? prisma.favoriteRestaurant.findUnique({
          where: { userId_restaurantId: { userId, restaurantId: restaurant.id } }
        })
      : Promise.resolve(null),
    userId
      ? prisma.favoriteItem.findMany({
          where: { userId, menuItem: { branchId: branch.id } },
          select: { menuItemId: true }
        })
      : Promise.resolve([] as { menuItemId: string }[])
  ]);
  const favItemSet = new Set(favItemRows.map((r) => r.menuItemId));

  const heroImage = restaurant.coverImageUrl || restaurant.logoUrl || FOOD_FALLBACK;
  const cms = parseStorefrontConfig((restaurant as { storefrontConfig?: unknown }).storefrontConfig);
  const heroSlides =
    cms.hero.type === 'carousel' && cms.hero.slides.length > 0
      ? cms.hero.slides
      : (bannersForSlug(slug) ?? []).map((src) => ({ src }));
  const dishCount = categories.reduce((s, c) => s + c.menuItems.length, 0);

  // Floating categories FAB entries — projected from the same `categories`
  // query so availability + counts match what MenuClient renders.
  const fabCategories: CategoryFabEntry[] = categories
    .filter((c) => c.menuItems.length > 0)
    .map((c) => {
      const status = isCategoryAvailableNow({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        scheduleEnabled: c.scheduleEnabled,
        availabilities: c.availabilities
      });
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        itemCount: c.menuItems.length,
        available: status.available,
        nextOpenLabel: status.available ? null : formatNextOpenLabel(status)
      };
    });
  // Real rating from delivered-order feedback, Bayesian-smoothed so a handful
  // of reviews don't swing the badge to extremes. Prior: mean 4.2 weighted as
  // 12 phantom reviews (standard "shrinkage" — see Google/Yelp style averages).
  const _fb = await prisma.orderFeedback.aggregate({
    _avg: { overallRating: true },
    _count: { overallRating: true },
    where: { overallRating: { not: null }, order: { branch: { restaurantId: restaurant.id } } },
  });
  const ratingCount = _fb._count.overallRating ?? 0;
  const _avg = _fb._avg.overallRating ?? 0;
  const PRIOR_MEAN = 4.2;
  const PRIOR_WEIGHT = 12;
  const ratingValue =
    ratingCount > 0
      ? ((PRIOR_WEIGHT * PRIOR_MEAN + _avg * ratingCount) / (PRIOR_WEIGHT + ratingCount)).toFixed(1)
      : null;
  // Back-compat: some callers still read `rating` as a plain string.
  const rating = ratingValue ?? PRIOR_MEAN.toFixed(1);
  // "Verified" badge tracks platform approval (super-admin gated).
  const isVerified = (restaurant as any).approvedAt != null;

  // Theme CSS variables (accent/secondary/radius/font) applied on the wrapper
  // so the CMS-driven sections (announcement, about, blocks, CTAs, social) pick
  // up the restaurant's chosen palette without overriding global tokens.
  const themeVars = themeStyleVars(cms) as React.CSSProperties;

  return {
    restaurant,
    branch,
    cms,
    themeVars,
    heroSlides,
    heroImage,
    siblingCuisineCount,
    happyHourRules,
    happyHourEnds,
    activeOffers,
    categories,
    combos,
    topSellers,
    fabCategories,
    favRestaurant,
    favItemSet,
    isAuthed,
    rating,
    ratingValue,
    ratingCount,
    isVerified,
    dishCount,
    now,
    openStatus
  };
}
