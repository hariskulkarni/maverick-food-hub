/**
 * Customer discovery radius — platform-wide setting (super-admin tunable).
 *   GET — current radius plus the allowed bounds + default.
 *   PUT — { radiusKm } → clamp & persist, return the clamped value.
 *
 * Reads/writes go through the platform-settings backbone (clamps to
 * [MIN, MAX]). Guarded by requireSuperAdmin(); responses are no-store.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import {
  getDiscoveryRadiusKm,
  setDiscoveryRadiusKm,
  DEFAULT_DISCOVERY_RADIUS_KM,
  MIN_DISCOVERY_RADIUS_KM,
  MAX_DISCOVERY_RADIUS_KM
} from '@/server/platform-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const radiusKm = await getDiscoveryRadiusKm();
  return Response.json(
    {
      radiusKm,
      min: MIN_DISCOVERY_RADIUS_KM,
      max: MAX_DISCOVERY_RADIUS_KM,
      default: DEFAULT_DISCOVERY_RADIUS_KM
    },
    { headers: NO_STORE }
  );
}

const PutBody = z.object({ radiusKm: z.number().finite() });

export async function PUT(req: NextRequest) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const body = PutBody.parse(await req.json());
  const before = await getDiscoveryRadiusKm();
  const radiusKm = await setDiscoveryRadiusKm(body.radiusKm);
  await audit('platform.discovery_radius.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSettings',
    before: { discoveryRadiusKm: before },
    after: { discoveryRadiusKm: radiusKm }
  });
  return Response.json({ radiusKm }, { headers: NO_STORE });
}
