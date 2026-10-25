import { AppDownloadCard } from '@/components/rider/app-download-card';
import { getRiderPortalState } from '@/server/rider-portal';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default async function RiderDashboardPage() {
  const s = await getRiderPortalState();
  const name = s.state === 'ok' ? s.rider.name : null;
  return (
    <Dashboard firstName={name?.trim().split(/\s+/)[0] ?? null}>
      <AppDownloadCard variant="compact" />
    </Dashboard>
  );
}
