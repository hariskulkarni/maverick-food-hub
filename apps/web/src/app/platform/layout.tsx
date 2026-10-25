import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { isPlatformRole, can, pageGateFor, ROLE_LABEL } from '@/server/permissions';
import type { Role } from '@prisma/client';
import { LogoutButton } from '../(customer)/profile/logout-button';
import { DemoBanner } from '@/components/demo-banner';
import { isDemoMode } from '@/lib/demo';
import { DemoResetButton } from './demo-reset-button';
import { AdminShell } from '@/components/shell/admin-shell';
import { PLATFORM_NAV, filterNavByAccess } from './_nav/nav-config';
import { PlatformNav } from './_nav/platform-nav';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || !isPlatformRole(role)) {
    redirect('/login?next=/platform&mode=admin');
  }
  // Capability-filtered nav (server-side): a delegated role only sees the
  // surfaces it can open. The client nav only groups/filters what it receives.
  const navGroups = filterNavByAccess(PLATFORM_NAV, (href) => can(role, pageGateFor(href)));
  return (
    <AdminShell
      title="Platform"
      subtitle={ROLE_LABEL[role as Role] ?? 'Platform team'}
      navSlot={<PlatformNav groups={navGroups} />}
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
