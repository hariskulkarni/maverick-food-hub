import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import {
  Building2, ListOrdered, Users, Bike, BarChart3, Radio, Coins,
  AlertTriangle, Activity, LifeBuoy, QrCode, Shield, FileSpreadsheet,
  History, BadgeCheck, Layers, Gift, MessageSquare, Wallet, Trophy,
  Flame, Award, UserPlus, Siren, ShieldAlert, CalendarClock, Headphones,
  GraduationCap, MessagesSquare, Banknote, LayoutTemplate,
} from 'lucide-react';
import { LogoutButton } from '../(customer)/profile/logout-button';
import { DemoBanner } from '@/components/demo-banner';
import { isDemoMode } from '@/lib/demo';
import { DemoResetButton } from './demo-reset-button';
import { AdminShell, type NavGroup } from '@/components/shell/admin-shell';

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/platform',               icon: BarChart3,       label: 'Dashboard' },
      { href: '/platform/analytics',     icon: BarChart3,       label: 'Deep analytics' },
      { href: '/platform/restaurants',   icon: Building2,       label: 'Restaurants' },
      { href: '/platform/brands',        icon: Layers,          label: 'Brands' },
      { href: '/platform/discovery-cms', icon: LayoutTemplate,  label: 'Discovery CMS' },
      { href: '/platform/signup-bonus',  icon: Gift,            label: 'Signup Bonus' },
      { href: '/platform/orders',        icon: ListOrdered,     label: 'All orders' },
      { href: '/platform/live',          icon: Radio,           label: 'Live tracking' },
      { href: '/platform/feedback',      icon: MessageSquare,   label: 'Feedback' },
      { href: '/platform/live-ops',      icon: AlertTriangle,   label: 'Live ops' },
      { href: '/platform/riders',        icon: Bike,            label: 'Riders' },
      { href: '/platform/kyc',           icon: BadgeCheck,      label: 'KYC review' },
      { href: '/platform/payouts',       icon: ListOrdered,     label: 'Payout rules' },
      { href: '/platform/cod',           icon: Coins,           label: 'COD' },
      { href: '/platform/users',         icon: Users,           label: 'All users' },
      { href: '/platform/support',       icon: LifeBuoy,        label: 'Support' },
      { href: '/platform/qr',            icon: QrCode,          label: 'QR codes' },
      { href: '/platform/settlements',   icon: Banknote,        label: 'Settlements' },
      { href: '/platform/reports',       icon: FileSpreadsheet, label: 'Reports' },
      { href: '/platform/security',      icon: Shield,          label: 'Security' },
      { href: '/platform/audit-log',     icon: History,         label: 'Audit log' },
      { href: '/platform/system-health', icon: Activity,        label: 'System health' },
      { href: '/platform/observability', icon: Activity,        label: 'Observability' },
    ],
  },
  {
    title: 'Rider operations',
    items: [
      { href: '/platform/messages',          icon: MessagesSquare,  label: 'Messages' },
      { href: '/platform/rider-payouts',     icon: Wallet,          label: 'Rider payouts' },
      { href: '/platform/rider-incentives',  icon: Trophy,          label: 'Incentives' },
      { href: '/platform/surge-zones',       icon: Flame,           label: 'Surge zones' },
      { href: '/platform/rider-tiers',       icon: Award,           label: 'Rider tiers' },
      { href: '/platform/rider-referrals',   icon: UserPlus,        label: 'Rider referrals' },
      { href: '/platform/rider-sos',         icon: Siren,           label: 'SOS alerts' },
      { href: '/platform/rider-incidents',   icon: ShieldAlert,     label: 'Incidents' },
      { href: '/platform/rider-shifts',      icon: CalendarClock,   label: 'Rider shifts' },
      { href: '/platform/rider-support',     icon: Headphones,      label: 'Rider support' },
      { href: '/platform/training-modules',  icon: GraduationCap,   label: 'Training modules' },
    ],
  },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/login?next=/platform&mode=admin');
  }
  return (
    <AdminShell
      title="Platform"
      subtitle="Super admin"
      navGroups={NAV_GROUPS}
      topBanner={<DemoBanner />}
      contentTopSlot={isDemoMode() ? <DemoResetButton /> : null}
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
