/**
 * /platform/rider-settings — super-admin rider operations settings: KYC gate,
 * safety-training gate, concurrent-order cap and rider-app earnings goals,
 * with live "riders that would be blocked" counts. Saves go through the
 * audited PATCH /api/platform/rider-settings. Dispatch JIT settings stay on
 * /platform/dispatch-insights (linked, not duplicated).
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { getRiderOpsSettings, getTrainingShiftGate } from '@/server/platform-settings';
import { computeRiderGateImpact } from '@/server/rider-settings-impact';
import { RiderSettingsClient } from './rider-settings-client';

export const metadata = { title: 'Platform · Rider settings' };
export const dynamic = 'force-dynamic';

export default async function RiderSettingsPage() {
  await requireSuperAdmin();
  const [ops, trainingShiftGate, impact] = await Promise.all([
    getRiderOpsSettings(),
    getTrainingShiftGate(),
    computeRiderGateImpact(),
  ]);
  return (
    <div className="p-4 sm:p-6">
      <RiderSettingsClient initial={{ ...ops, trainingShiftGate }} initialImpact={impact} />
    </div>
  );
}
