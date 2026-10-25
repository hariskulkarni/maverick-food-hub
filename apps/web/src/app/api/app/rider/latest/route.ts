/**
 * GET /api/app/rider/latest?platform=android&channel=stable&versionCode=12
 *
 * Public update check for the native rider app (no auth — it runs before
 * sign-in too, so an outdated build can be told to update on the login screen).
 *
 * 200: { latest: PublicReleaseDto | null, updateAvailable, updateRequired }
 *   updateAvailable — a newer versionCode is published on this channel.
 *   updateRequired  — the running versionCode is below the active release's
 *                     minSupportedVersionCode (the app shows a blocking screen).
 */
import { NextRequest } from 'next/server';
import { getActiveRelease, parseChannel, parsePlatform, toPublicDto, updateStatus } from '@/server/app-releases';
import { rateLimit } from '@/server/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'app-latest', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const sp = req.nextUrl.searchParams;
  const platform = parsePlatform(sp.get('platform'));
  const channel = parseChannel(sp.get('channel'));
  if (!platform || !channel) return Response.json({ error: 'Unknown platform or channel.' }, { status: 400 });
  const rawCode = sp.get('versionCode');
  const current = rawCode != null && /^\d{1,10}$/.test(rawCode) ? Number(rawCode) : null;
  const release = await getActiveRelease(platform, channel);
  const latest = release ? toPublicDto(release) : null;
  return Response.json(
    { latest, ...updateStatus(current, latest) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
