/**
 * /platform/safety-alerts — super-admin thresholds + per-type toggles for the
 * rider safety & anomaly alerts sweep (route deviation, ETA breach, long wait
 * at restaurant, prolonged signal loss). The alerts themselves surface on
 * /platform/live-ops. Saves go through the audited PATCH
 * /api/platform/safety-alerts/settings.
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { getSafetyAlertSettings } from '@/server/safety/settings';
import { SafetyAlertsClient } from './safety-alerts-client';

export const metadata = { title: 'Platform · Safety alerts' };
export const dynamic = 'force-dynamic';

export default async function SafetyAlertsPage() {
  await requireSuperAdmin();
  const settings = await getSafetyAlertSettings();
  return (
    <div className="p-4 sm:p-6">
      <SafetyAlertsClient initial={settings} />
    </div>
  );
}
