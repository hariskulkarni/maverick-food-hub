import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { currentRestaurant, accessibleRestaurants } from '@/server/tenancy';
import { LayoutDashboard, ScrollText, CalendarClock, Armchair, Radio, Building2, Bike, ShieldAlert, MessagesSquare, BarChart3, History, MessageSquare, Settings, Paintbrush } from 'lucide-react';
import { LogoutButton } from '../(customer)/profile/logout-button';
import { RestaurantSwitcher } from './restaurant-switcher';
import { DemoBanner } from '@/components/demo-banner';

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
          <p className="text-muted-foreground">Your account isn't tied to any restaurant yet. If you just signed up, an admin still needs to approve you. <Link href="/signup/restaurant" className="text-primary underline">Open a new restaurant</Link>.</p>
        </div>
      </div>
    );
  }
  if (restaurant.status !== 'ACTIVE') {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="display text-2xl font-semibold">Restaurant {restaurant.status.toLowerCase()}</h1>
          <p className="text-muted-foreground">{restaurant.name} is {restaurant.status === 'PENDING' ? 'awaiting platform approval' : restaurant.status === 'SUSPENDED' ? 'temporarily suspended' : 'not active'}.{restaurant.rejectedReason ? ` Reason: ${restaurant.rejectedReason}` : ''}</p>
          <p className="text-sm">If this is unexpected, contact platform support.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <div className="grid flex-1 grid-cols-[240px_1fr]">
      <aside className="border-r bg-card flex flex-col">
        <div className="p-5 border-b">
          {flat.length > 1 ? (
            <RestaurantSwitcher groups={groups} activeId={activeId} />
          ) : (
            <Link href="/admin" className="display text-lg font-bold text-primary">{restaurant.name}</Link>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">Restaurant admin</div>
        </div>
        {/* Split: storefront-shaping surfaces (page design, menu, promotions,
            integrations) live in the Storefront CMS hub; day-to-day operations
            live here on the sidebar. The two never duplicate each other. */}
        <nav className="flex-1 p-3 space-y-1 text-sm">
          <NavLink href="/admin" icon={LayoutDashboard}>Dashboard</NavLink>
          <NavLink href="/admin/orders" icon={ScrollText}>Orders</NavLink>
          <NavLink href="/admin/reservations" icon={CalendarClock}>Reservations</NavLink>
          <NavLink href="/admin/tables" icon={Armchair}>Tables</NavLink>
          <NavLink href="/admin/live" icon={Radio}>Live tracking</NavLink>
          <NavLink href="/admin/branches" icon={Building2}>Branches</NavLink>
          <NavLink href="/admin/riders" icon={Bike}>Dedicated Riders</NavLink>
          <NavLink href="/admin/safety" icon={ShieldAlert}>Rider Safety</NavLink>
          <NavLink href="/admin/messages" icon={MessagesSquare}>Messages</NavLink>
          <NavLink href="/admin/reports" icon={BarChart3}>Reports</NavLink>
          <NavLink href="/admin/activity" icon={History}>Activity</NavLink>
          <NavLink href="/admin/feedback" icon={MessageSquare}>Feedback</NavLink>
          <div className="my-2 border-t" />
          <NavLink href="/admin/storefront" icon={Paintbrush}>Storefront CMS</NavLink>
          <NavLink href="/admin/settings" icon={Settings}>Settings</NavLink>
        </nav>
        <div className="p-3 border-t">
          <div className="text-xs text-muted-foreground">{session.user.name ?? session.user.email}</div>
          <LogoutButton />
        </div>
      </aside>
      <main className="bg-background overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, icon: Icon, children }: { href: string; icon: any; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent">
      <Icon className="size-4" /> {children}
    </Link>
  );
}
