import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { Building2, ListOrdered, Users, Bike, BarChart3, Radio, Coins, AlertTriangle, Activity, LifeBuoy, QrCode, Shield, FileSpreadsheet, History, BadgeCheck, Layers, Gift, MessageSquare, Wallet, Trophy, Flame, Award, UserPlus, Siren, ShieldAlert, CalendarClock, Headphones, GraduationCap, MessagesSquare } from 'lucide-react';
import { LogoutButton } from '../(customer)/profile/logout-button';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') redirect('/login?next=/platform&mode=admin');
  return (
    <div className="grid min-h-dvh grid-cols-[240px_1fr]">
      <aside className="border-r bg-card flex flex-col">
        <div className="p-5 border-b">
          <Link href="/platform" className="display text-lg font-bold text-primary">Platform</Link>
          <div className="text-xs text-muted-foreground mt-0.5">Super admin</div>
        </div>
        <nav className="flex-1 p-3 space-y-1 text-sm">
          <NavLink href="/platform" icon={BarChart3}>Dashboard</NavLink>
          <NavLink href="/platform/analytics" icon={BarChart3}>Deep analytics</NavLink>
          <NavLink href="/platform/restaurants" icon={Building2}>Restaurants</NavLink>
          <NavLink href="/platform/brands" icon={Layers}>Brands</NavLink>
          <NavLink href="/platform/signup-bonus" icon={Gift}>Signup Bonus</NavLink>
          <NavLink href="/platform/orders" icon={ListOrdered}>All orders</NavLink>
          <NavLink href="/platform/live" icon={Radio}>Live tracking</NavLink>
          <NavLink href="/platform/feedback" icon={MessageSquare}>Feedback</NavLink>
          <NavLink href="/platform/live-ops" icon={AlertTriangle}>Live ops</NavLink>
          <NavLink href="/platform/riders" icon={Bike}>Riders</NavLink>
          <NavLink href="/platform/kyc" icon={BadgeCheck}>KYC review</NavLink>
          <NavLink href="/platform/payouts" icon={ListOrdered}>Payout rules</NavLink>
          <NavLink href="/platform/cod" icon={Coins}>COD</NavLink>
          <NavLink href="/platform/users" icon={Users}>All users</NavLink>
          <NavLink href="/platform/support" icon={LifeBuoy}>Support</NavLink>
          <NavLink href="/platform/qr" icon={QrCode}>QR codes</NavLink>
          <NavLink href="/platform/reports" icon={FileSpreadsheet}>Reports</NavLink>
          <NavLink href="/platform/security" icon={Shield}>Security</NavLink>
          <NavLink href="/platform/audit-log" icon={History}>Audit log</NavLink>
          <NavLink href="/platform/system-health" icon={Activity}>System health</NavLink>
          <NavLink href="/platform/observability" icon={Activity}>Observability</NavLink>

          <NavSection>Rider operations</NavSection>
          <NavLink href="/platform/messages" icon={MessagesSquare}>Messages</NavLink>
          <NavLink href="/platform/rider-payouts" icon={Wallet}>Rider payouts</NavLink>
          <NavLink href="/platform/rider-incentives" icon={Trophy}>Incentives</NavLink>
          <NavLink href="/platform/surge-zones" icon={Flame}>Surge zones</NavLink>
          <NavLink href="/platform/rider-tiers" icon={Award}>Rider tiers</NavLink>
          <NavLink href="/platform/rider-referrals" icon={UserPlus}>Rider referrals</NavLink>
          <NavLink href="/platform/rider-sos" icon={Siren}>SOS alerts</NavLink>
          <NavLink href="/platform/rider-incidents" icon={ShieldAlert}>Incidents</NavLink>
          <NavLink href="/platform/rider-shifts" icon={CalendarClock}>Rider shifts</NavLink>
          <NavLink href="/platform/rider-support" icon={Headphones}>Rider support</NavLink>
          <NavLink href="/platform/training-modules" icon={GraduationCap}>Training modules</NavLink>
        </nav>
        <div className="p-3 border-t">
          <div className="text-xs text-muted-foreground">{session.user.name ?? session.user.email}</div>
          <LogoutButton />
        </div>
      </aside>
      <main className="bg-background overflow-x-auto">{children}</main>
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

function NavSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}
