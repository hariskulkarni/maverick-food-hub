import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { currentRestaurant, accessibleRestaurants } from '@/server/tenancy';
import {
  LayoutDashboard, ScrollText, CalendarClock, Armchair, Radio, Building2,
  Bike, ShieldAlert, MessagesSquare, BarChart3, History, MessageSquare,
  Settings, Paintbrush,
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
      { href: '/admin/orders',         icon: <ScrollText className={ICON} />,      label: 'Orders' },
      { href: '/admin/reservations',   icon: <CalendarClock className={ICON} />,   label: 'Reservations' },
      { href: '/admin/tables',         icon: <Armchair className={ICON} />,        label: 'Tables' },
      { href: '/admin/live',           icon: <Radio className={ICON} />,           label: 'Live tracking' },
      { href: '/admin/branches',       icon: <Building2 className={ICON} />,       label: 'Branches' },
      { href: '/admin/riders',         icon: <Bike className={ICON} />,            label: 'Dedicated Riders' },
      { href: '/admin/safety',         icon: <ShieldAlert className={ICON} />,     label: 'Rider Safety' },
      { href: '/admin/messages',       icon: <MessagesSquare className={ICON} />,  label: 'Messages' },
      { href: '/admin/reports',        icon: <BarChart3 className={ICON} />,       label: 'Reports' },
      { href: '/admin/activity',       icon: <History className={ICON} />,         label: 'Activity' },
      { href: '/admin/feedback',       icon: <MessageSquare className={ICON} />,   label: 'Feedback' },
    ],
  },
  {
    title: 'Storefront',
    items: [
      { href: '/admin/storefront',     icon: <Paintbrush className={ICON} />,      label: 'Storefront CMS' },
      { href: '/admin/settings',       icon: <Settings className={ICON} />,        label: 'Settings' },
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
          <p className="text-sm">If this is unexpected, contact platform support.</p>
        </div>
      </div>
    );
  }

  const title = flat.length > 1
    ? <RestaurantSwitcher groups={groups} activeId={activeId} />
    : <Link href="/admin" className="display text-lg font-bold text-primary">{restaurant.name}</Link>;

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
      {children}
    </AdminShell>
  );
}
