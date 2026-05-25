/**
 * POST /api/platform/jobs/food-license-expiry/run
 *
 * Scans active branches whose FSSAI licence is expiring within 30 days or has
 * already expired and notifies the restaurant's admins (email + SMS). The
 * underlying sender debounces per branch (~once / 3 days). Intended for a daily
 * cron (e.g. 06:00 IST) or on-demand from the super-admin dashboard.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runFoodLicenseExpirySweep } from '@/server/jobs/food-license-expiry-sweep';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    (internalSecret && headerSecret === internalSecret) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const result = await runFoodLicenseExpirySweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
