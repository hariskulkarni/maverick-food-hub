import { requireRestaurant, accessibleRestaurants } from '@/server/tenancy';
import { CmsRestaurantPicker } from './cms-restaurant-picker';
import { CmsTabs } from './cms-tabs';
import { LogoMark } from '@/components/brand/logo';

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
      <div className="px-4 pt-4 sm:px-6 sm:pt-6 space-y-4">
        <header className="flex items-center gap-3 sm:gap-4">
          <LogoMark className="size-11 shrink-0 sm:size-12" />
          <div className="min-w-0">
            <h1 className="display text-gradient-brand text-2xl font-semibold sm:text-3xl">Storefront</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Design your public storefront, menu, promotions, and integrations.
            </p>
          </div>
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
