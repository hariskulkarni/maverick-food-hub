/**
 * GET /download/rider-app[?channel=beta][&platform=ios]
 *
 * Public download of the active rider app release (default: stable Android).
 *   - Hosted APK  → streamed from PRIVATE storage (never a static URL) with
 *                   Content-Type, Content-Disposition, Content-Length and the
 *                   SHA-256 in X-Checksum-SHA256.
 *   - External    → 302 to the registered download URL / store listing.
 *   - None active → 302 back to /rider-app?download=unavailable.
 * Every successful hand-off increments AppRelease.downloadCount. Rate-limited
 * per IP (the APK is large; this stops a single client hammering it).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { openPrivateStream } from '@/server/storage';
import { APK_MIME, downloadFileName, getActiveRelease, parseChannel, parsePlatform } from '@/server/app-releases';
import { rateLimit } from '@/server/http/rate-limit';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unavailable(reason: string): Response {
  // Relative Location (RFC 7231) so it stays on whatever host served the request.
  return new Response(null, { status: 302, headers: { Location: `/rider-app?download=${reason}#download`, 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'rider-app-download', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const platform = parsePlatform(req.nextUrl.searchParams.get('platform'));
  const channel = parseChannel(req.nextUrl.searchParams.get('channel'));
  if (!platform || !channel) return new Response('Unknown platform or channel', { status: 400 });

  const release = await getActiveRelease(platform, channel);
  if (!release) return unavailable('unavailable');

  const count = () =>
    prisma.appRelease.update({ where: { id: release.id }, data: { downloadCount: { increment: 1 } } }).catch(() => {});

  if (release.fileRef) {
    const file = await openPrivateStream(release.fileRef);
    if (!file) {
      log.error({ releaseId: release.id }, 'rider-app download: release file missing from private storage');
      return unavailable('unavailable');
    }
    await count();
    const headers = new Headers({
      'Content-Type': APK_MIME,
      'Content-Disposition': `attachment; filename="${downloadFileName(release)}"`,
      'Content-Length': String(file.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (release.sha256) headers.set('X-Checksum-SHA256', release.sha256);
    return new Response(file.stream, { status: 200, headers });
  }

  const target = release.downloadUrl || release.storeUrl;
  if (!target) return unavailable('unavailable');
  await count();
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}
