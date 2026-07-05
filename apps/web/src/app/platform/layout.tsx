import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { isPlatformRole, can, pageGateFor, ROLE_LABEL } from '@/server/permissions';
import type { Role } from '@prisma/client';
import {
  Building2, ListOrdered, Users, Bike, BarChart3, Radio, Coins,
  AlertTriangle, Activity, LifeBuoy, QrCode, Shield, FileSpreadsheet,
  History, BadgeCheck, Layers, Gift, MessageSquare, Wallet, Trophy, ShieldCheck,
  Flame, Award, UserPlus, Siren, ShieldAlert, CalendarClock, Headphones,
  GraduationCap, MessagesSquare, Banknote, LayoutTemplate,
} from 'lucide-react';
import { LogoutButton } from '../(customer)/profile/logout-button';
import { DemoBanner } from '@/components/demo-banner';
import { isDemoMode } from '@/lib/demo';
import { DemoResetButton } from './demo-reset-button';
import { AdminShell, type NavGroup } from '@/components/shell/admin-shell';

// Pre-rendered icon JSX — see admin/layout.tsx for the why-this-matters note.
// Short version: AdminShell passes navGroups to MobileNavBar (client) and Lucide
// icon components cannot be serialized across the boundary as function refs.
const I = 'size-4 shrink-0';
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/platform',               icon: <BarChart3 className={I} />,       label: 'Dashboard' },
      { href: '/platform/analytics',     icon: <BarChart3 className={I} />,       label: 'Deep analytics' },
      { href: '/platform/restaurants',   icon: <Building2 className={I} />,       label: 'Restaurants' },
      { href: '/platform/brands',        icon: <Layers className={I} />,          label: 'Brands' },
      { href: '/platform/discovery-cms', icon: <LayoutTemplate className={I} />,  label: 'Discovery CMS' },
      { href: '/platform/signup-bonus',  icon: <Gift className={I} />,            label: 'Signup Bonus' },
      { href: '/platform/orders',        icon: <ListOrdered className={I} />,     label: 'All orders' },
      { href: '/platform/live',          icon: <Radio className={I} />,           label: 'Live tracking' },
      { href: '/platform/feedback',      icon: <MessageSquare className={I} />,   label: 'Feedback' },
      { href: '/platform/live-ops',      icon: <AlertTriangle className={I} />,   label: 'Live ops' },
      { href: '/platform/riders',        icon: <Bike className={I} />,            label: 'Riders' },
      { href: '/platform/kyc',           icon: <BadgeCheck className={I} />,      label: 'KYC review' },
      { href: '/platform/payouts',       icon: <ListOrdered className={I} />,     label: 'Payout rules' },
      { href: '/platform/cod',           icon: <Coins className={I} />,           label: 'COD' },
      { href: '/platform/iam',           icon: <ShieldCheck className={I} />,     label: 'IAM & roles' },
      { href: '/platform/users',         icon: <Users className={I} />,           label: 'All users' },
      { href: '/platform/support',       icon: <LifeBuoy className={I} />,        label: 'Support' },
      { href: '/platform/qr',            icon: <QrCode className={I} />,          label: 'QR codes' },
      { href: '/platform/settlements',   icon: <Banknote className={I} />,        label: 'Settlements' },
      { href: '/platform/reports',       icon: <FileSpreadsheet className={I} />, label: 'Reports' },
      { href: '/platform/security',      icon: <Shield className={I} />,          label: 'Security' },
      { href: '/platform/audit-log',     icon: <History className={I} />,         label: 'Audit log' },
      { href: '/platform/system-health', icon: <Activity className={I} />,        label: 'System health' },
      { href: '/platform/observability', icon: <Activity className={I} />,        label: 'Observability' },
    ],
  },
  {
    title: 'Rider operations',
    items: [
      { href: '/platform/messages',          icon: <MessagesSquare className={I} />, label: 'Messages' },
      { href: '/platform/rider-payouts',     icon: <Wallet className={I} />,         label: 'Rider payouts' },
      { href: '/platform/rider-incentives',  icon: <Trophy className={I} />,         label: 'Incentives' },
      { href: '/platform/surge-zones',       icon: <Flame className={I} />,          label: 'Surge zones' },
      { href: '/platform/rider-tiers',       icon: <Award className={I} />,          label: 'Rider tiers' },
      { href: '/platform/rider-referrals',   icon: <UserPlus className={I} />,       label: 'Rider referrals' },
      { href: '/platform/rider-sos',         icon: <Siren className={I} />,          label: 'SOS alerts' },
      { href: '/platform/rider-incidents',   icon: <ShieldAlert className={I} />,    label: 'Incidents' },
      { href: '/platform/rider-shifts',      icon: <CalendarClock className={I} />,  label: 'Rider shifts' },
      { href: '/platform/rider-support',     icon: <Headphones className={I} />,     label: 'Rider support' },
      { href: '/platform/training-modules',  icon: <GraduationCap className={I} />,  label: 'Training modules' },
    ],
  },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || !isPlatformRole(role)) {
    redirect('/login?next=/platform&mode=admin');
  }
  // Capability-filtered nav: a delegated role only sees the surfaces it can open.
  const navGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => can(role, pageGateFor(it.href))) }))
    .filter((g) => g.items.length > 0);
  return (
    <AdminShell
      title="Platform"
      subtitle={ROLE_LABEL[role as Role] ?? 'Platform team'}
      navGroups={navGroups}
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
