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

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/admin',                icon: LayoutDashboard,   label: 'Dashboard' },
      { href: '/admin/orders',         icon: ScrollText,        label: 'Orders' },
      { href: '/admin/reservations',   icon: CalendarClock,     label: 'Reservations' },
      { href: '/admin/tables',         icon: Armchair,          label: 'Tables' },
      { href: '/admin/live',           icon: Radio,             label: 'Live tracking' },
      { href: '/admin/branches',       icon: Building2,         label: 'Branches' },
      { href: '/admin/riders',         icon: Bike,              label: 'Dedicated Riders' },
      { href: '/admin/safety',         icon: ShieldAlert,       label: 'Rider Safety' },
      { href: '/admin/messages',       icon: MessagesSquare,    label: 'Messages' },
      { href: '/admin/reports',        icon: BarChart3,         label: 'Reports' },
      { href: '/admin/activity',       icon: History,           label: 'Activity' },
      { href: '/admin/feedback',       icon: MessageSquare,     label: 'Feedback' },
    ],
  },
  {
    title: 'Storefront',
    items: [
      { href: '/admin/storefront',     icon: Paintbrush,        label: 'Storefront CMS' },
      { href: '/admin/settings',       icon: Settings,          label: 'Settings' },
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
