/**
 * Restaurant-admin Happy Hours dashboard.
 *
 * Server component. Loads everything the client needs in one pass:
 *   - every Happy Hour rule (incl. schedules) scoped to this restaurant
 *   - lightweight category / menu-item / combo lists for the scope picker
 *
 * Each rule is bucketed by `lifecycleBucket(rule, now)` so the client can
 * render the Active / Upcoming / Expired counts without re-computing.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { lifecycleBucket, type HappyHourRuleLite } from '@/server/happy-hours';
import { HappyHoursClient } from './happy-hours-client';

export const metadata = { title: 'Admin · Happy Hours' };
export const dynamic = 'force-dynamic';

export default async function HappyHoursPage() {
  const restaurant = await requireRestaurant();

  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true }
  });
  const branchIds = branches.map((b) => b.id);

  const [categories, menuItems, combos, rules] = await Promise.all([
    prisma.category.findMany({
      where: { branchId: { in: branchIds } },
      orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, name: true, branchId: true }
    }),
    prisma.menuItem.findMany({
      where: { branchId: { in: branchIds } },
      orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, name: true, branchId: true, categoryId: true, price: true }
    }),
    prisma.combo.findMany({
      where: { branchId: { in: branchIds } },
      orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, name: true, branchId: true, price: true }
    }),
    (prisma as any).happyHourRule.findMany({
      where: { restaurantId: restaurant.id },
      include: { schedules: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
    })
  ]);

  const now = new Date();
  const bucketed = (rules as any[]).map((r) => ({
    ...r,
    lifecycle: lifecycleBucket(toLite(r), now)
  }));

  const counts = {
    active: bucketed.filter((r) => r.lifecycle === 'active').length,
    upcoming: bucketed.filter((r) => r.lifecycle === 'upcoming').length,
    expired: bucketed.filter((r) => r.lifecycle === 'expired').length
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Happy Hours</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Time-of-day pricing for {restaurant.name}. Happy Hour rules rewrite the
          displayed unit price *before* the offer engine runs, so customers see
          and pay the discounted amount per piece.
        </p>
      </header>
      <HappyHoursClient
        rules={JSON.parse(JSON.stringify(bucketed))}
        categories={categories}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
        combos={JSON.parse(JSON.stringify(combos))}
        counts={counts}
      />
    </div>
  );
}

function toLite(r: any): HappyHourRuleLite {
  return {
    id: r.id,
    name: r.name,
    scope: r.scope,
    categoryId: r.categoryId ?? null,
    menuItemId: r.menuItemId ?? null,
    comboId: r.comboId ?? null,
    discountType: r.discountType,
    percentOff: r.percentOff ?? null,
    fixedPrice: r.fixedPrice ?? null,
    amountOff: r.amountOff ?? null,
    minPrice: r.minPrice ?? null,
    validFrom: r.validFrom,
    validTo: r.validTo,
    isActive: r.isActive,
    priority: r.priority,
    schedules: (r.schedules ?? []).map((s: any) => ({
      dayOfWeek: s.dayOfWeek,
      startMin: s.startMin,
      endMin: s.endMin
    }))
  };
}
