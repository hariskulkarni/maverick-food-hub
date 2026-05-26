import { requireRestaurant, accessibleRestaurants } from '@/server/tenancy';
import { CmsRestaurantPicker } from './cms-restaurant-picker';
import { CmsTabs } from './cms-tabs';

export const dynamic = 'force-dynamic';

/**
 * Storefront CMS hub shell — the restaurant's full control center. Renders the
 * shared header, the umbrella restaurant picker (so a group admin can choose
 * which outlet they're managing), and the top-level tab bar. Each tab is a
 * nested route (some are groups with their own sub-tab bar) rendered as
 * {children}. Full-width so wide operational views (orders, live tracking,
 * dashboard) get room; narrow forms self-constrain their own width.
 */
export default async function StorefrontCmsLayout({ children }: { children: React.ReactNode }) {
  const restaurant = await requireRestaurant();
  const access = await accessibleRestaurants();

  return (
    <div>
      <div className="px-6 pt-6 space-y-4">
        <header>
          <h1 className="display text-3xl font-semibold">Storefront CMS</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your restaurant control center — page design, menu, promotions, operations, team, insights and integrations.
            Public page: <span className="font-mono">/r/{restaurant.slug}</span>.
          </p>
        </header>

        {access.flat.length > 1 && (
          <div className="max-w-md">
            <CmsRestaurantPicker groups={access.groups} activeId={access.activeId} />
          </div>
        )}

        <CmsTabs />
      </div>

      {children}
    </div>
  );
}
