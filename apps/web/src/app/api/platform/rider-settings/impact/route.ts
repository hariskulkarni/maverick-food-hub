/**
 * GET /api/platform/rider-settings/impact — super-admin, read-only.
 * How many active riders the KYC gate / training gate would block right now
 * (shown in the confirm dialog on /platform/rider-settings).
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { computeRiderGateImpact } from '@/server/rider-settings-impact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  return Response.json(await computeRiderGateImpact());
}
