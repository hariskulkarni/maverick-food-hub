import { requireRestaurant, accessibleRestaurants } from '@/server/tenancy';
import { CmsRestaurantPicker } from './cms-restaurant-picker';
import { CmsTabs } from './cms-tabs';

export const dynamic = 'force-dynamic';

/**
 * Storefront CMS hub shell. Renders the shared header, the umbrella restaurant
 * picker (so a group admin can choose which outlet they're managing), and the
 * tab bar (Design · Menu · Integrations · Reports). Each tab is a nested route
 * rendered as {children}.
 */
export default async function StorefrontCmsLayout({ children }: { children: React.ReactNode }) {
  const restaurant = await requireRestaurant();
  const access = await accessibleRestaurants();

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <header>
        <h1 className="display text-3xl font-semibold">Storefront CMS</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your restaurant control center — design your page, manage the menu, connect integrations, and pull reports.
          Public page: <span className="font-mono">/r/{restaurant.slug}</span>.
        </p>
      </header>

      {access.flat.length > 1 && (
        <CmsRestaurantPicker groups={access.groups} activeId={access.activeId} />
      )}

      <CmsTabs />

      <div>{children}</div>
    </div>
  );
}
