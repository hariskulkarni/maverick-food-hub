import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { currentRestaurant, accessibleRestaurants } from '@/server/tenancy';
import {
  LayoutDashboard, ScrollText, CalendarClock, Armchair, Radio, Building2,
  Bike, ShieldAlert, MessagesSquare, BarChart3, History, MessageSquare,
  Settings, Paintbrush, Star, MapPinned, LifeBuoy, Rocket, GraduationCap,
  Landmark,
} from 'lucide-react';
import { LogoutButton } from '../(customer)/profile/logout-button';
import { RestaurantSwitcher } from './restaurant-switcher';
import { DemoBanner } from '@/components/demo-banner';
import { AdminShell, type NavGroup } from '@/components/shell/admin-shell';

// CRITICAL: icons are pre-rendered as JSX elements (not component
// references) because AdminShell passes navGroups across the
// Server -> Client component boundary into MobileNavBar. Lucide icon
// components are forwardRef-wrapped functions and cannot be serialized
// directly — but a pre-rendered React element CAN be. Passing
// `icon: SomeIcon` (function reference) here crashes the page with
// "Functions cannot be passed directly to Client Components".
const ICON = 'size-4 shrink-0';
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/admin',                icon: <LayoutDashboard className={ICON} />, label: 'Dashboard' },
      { href: '/admin/onboarding',     icon: <Rocket className={ICON} />,          label: 'Setup guide' },
      { href: '/admin/orders',         icon: <ScrollText className={ICON} />,      label: 'Orders' },
      { href: '/admin/reservations',   icon: <CalendarClock className={ICON} />,   label: 'Reservations' },
      { href: '/admin/tables',         icon: <Armchair className={ICON} />,        label: 'Tables' },
      { href: '/admin/live',           icon: <Radio className={ICON} />,           label: 'Live tracking' },
      { href: '/admin/branches',       icon: <Building2 className={ICON} />,       label: 'Branches' },
      { href: '/admin/delivery-zones', icon: <MapPinned className={ICON} />,    label: 'Delivery Zones' },
      { href: '/admin/riders',         icon: <Bike className={ICON} />,            label: 'Dedicated Riders' },
      { href: '/admin/safety',         icon: <ShieldAlert className={ICON} />,     label: 'Rider Safety' },
      { href: '/admin/messages',       icon: <MessagesSquare className={ICON} />,  label: 'Messages' },
      { href: '/admin/reports',        icon: <BarChart3 className={ICON} />,       label: 'Reports' },
      { href: '/admin/flavrly-pg',     icon: <Landmark className={ICON} />,        label: 'Flavrly PG' },
      { href: '/admin/activity',       icon: <History className={ICON} />,         label: 'Activity' },
      { href: '/admin/feedback',       icon: <MessageSquare className={ICON} />,   label: 'Feedback' },
      { href: '/admin/reviews',        icon: <Star className={ICON} />,            label: 'Reviews' },
      { href: '/admin/reviews/recovery', icon: <LifeBuoy className={ICON} />,      label: 'Service recovery' },
      { href: '/admin/training',       icon: <GraduationCap className={ICON} />,   label: 'Training' },
    ],
  },
  {
    title: 'Storefront',
    items: [
      { href: '/admin/storefront',     icon: <Paintbrush className={ICON} />,      label: 'Storefront CMS' },
      { href: '/admin/settings',       icon: <Settings className={ICON} />,        label: 'Settings' },
      { href: '/admin/help',           icon: <LifeBuoy className={ICON} />,        label: 'Help center' },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') redirect('/login?next=/admin&mode=admin');
  const restaurant = await currentRestaurant();
  const { groups, flat, activeId } = await accessibleRestaurants();

  if (!restaurant) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="display text-2xl font-semibold">No restaurant linked</h1>
          <p className="text-muted-foreground">
            Your account isn&apos;t tied to any restaurant yet. If you just signed up, an admin still
            needs to approve you. <Link href="/signup/restaurant" className="text-primary underline">
            Open a new restaurant</Link>.
          </p>
        </div>
      </div>
    );
  }
  if (restaurant.status !== 'ACTIVE') {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="display text-2xl font-semibold">Restaurant {restaurant.status.toLowerCase()}</h1>
          <p className="text-muted-foreground">
            {restaurant.name} is {restaurant.status === 'PENDING' ? 'awaiting platform approval'
              : restaurant.status === 'SUSPENDED' ? 'temporarily suspended' : 'not active'}.
            {restaurant.rejectedReason ? ` Reason: ${restaurant.rejectedReason}` : ''}
          </p>
          {restaurant.status === 'PENDING' && (
            <div className="rounded-lg border bg-muted/30 p-4 text-left text-sm">
              <div className="font-medium">What happens next</div>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>The Flavrly team reviews your application — usually within 1 business day.</li>
                <li>Once approved, sign in again and the setup guide opens automatically: FSSAI licence, full menu, delivery zones, staff and QR code.</li>
                <li>Pass the readiness check and press <b>Go live</b>.</li>
              </ol>
            </div>
          )}
          <p className="text-sm">If this is unexpected, contact platform support.</p>
        </div>
      </div>
    );
  }

  const title = flat.length > 1
    ? <RestaurantSwitcher groups={groups} activeId={activeId} />
    : <Link href="/admin" className="display text-lg font-bold text-primary">{restaurant.name}</Link>;

  // P1-5: authorisation follows the per-restaurant MEMBERSHIP role, not the
  // global User.role. A global ADMIN who only holds a KITCHEN grant on the
  // active restaurant gets the switcher + a pointer to the kitchen console,
  // never the admin screens (every admin API refuses them anyway).
  const activeRole = flat.find((r) => r.id === restaurant.id)?.role;
  const kitchenOnly = activeRole === 'KITCHEN';

  return (
    <AdminShell
      title={title}
      subtitle="Restaurant admin"
      navGroups={NAV_GROUPS}
      topBanner={<DemoBanner />}
      footer={
        <>
          <div className="text-xs text-muted-foreground truncate">{session.user.name ?? session.user.email}</div>
          <LogoutButton />
        </>
      }
    >
      {kitchenOnly ? (
        <div className="mx-auto max-w-md space-y-3 py-16 text-center">
          <h1 className="display text-2xl font-semibold">Kitchen access only</h1>
          <p className="text-muted-foreground">
            You have kitchen access to {restaurant.name}, not admin access. Switch to a restaurant you
            manage, or run orders from the kitchen console.
          </p>
          <Link href="/kitchen" className="text-primary underline">Open the kitchen console</Link>
        </div>
      ) : children}
    </AdminShell>
  );
}
