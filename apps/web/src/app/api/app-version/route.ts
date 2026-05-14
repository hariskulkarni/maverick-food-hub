/**
 * GET /api/app-version?platform=ANDROID_RIDER
 *
 * Rider/customer apps poll this on boot. If the installed build is below
 * `minVersion` (or `forceUpdate` is set), the app blocks until the user
 * upgrades. Defaults to a permissive "1.0.0" when nothing is configured.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { AppPlatform } from '@prisma/client';

export const dynamic = 'force-dynamic';

const DEFAULT_RESPONSE = {
  minVersion: '1.0.0',
  latestVersion: '1.0.0',
  forceUpdate: false
} as const;

function parsePlatform(raw: string | null): AppPlatform | null {
  if (!raw) return null;
  if (raw === 'ANDROID_RIDER' || raw === 'IOS_RIDER' || raw === 'WEB') return raw;
  return null;
}

export async function GET(req: NextRequest) {
  const platform = parsePlatform(req.nextUrl.searchParams.get('platform'));
  if (!platform) {
    return Response.json(DEFAULT_RESPONSE);
  }

  const row = await prisma.appVersion.findUnique({ where: { platform } });
  if (!row) return Response.json(DEFAULT_RESPONSE);

  return Response.json({
    minVersion: row.minVersion,
    latestVersion: row.latestVersion,
    forceUpdate: row.forceUpdate,
    ...(row.updateUrl ? { updateUrl: row.updateUrl } : {})
  });
}
