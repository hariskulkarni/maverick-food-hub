/**
 * POST /api/platform/app-releases/upload — super-admin only.
 *
 * Raw request body = the APK bytes (NOT multipart), so a 200 MB file streams
 * straight to PRIVATE storage without being buffered in memory. Headers:
 *   Content-Type: application/vnd.android.package-archive   (required)
 *   X-File-Name:  original file name, must end in .apk        (required)
 * Validation: type header, .apk name, Content-Length ≤ 200 MB (and a running
 * byte cap), ZIP magic bytes. SHA-256 is computed server-side while streaming.
 *
 * 200: { uploadToken, sha256, fileSize, fileName } — pass `uploadToken` to
 * POST /api/platform/app-releases to publish. The token is HMAC-signed and
 * bound to this super-admin, so the publish step can't point at any other file.
 *
 * This path is excluded from the middleware matcher (no body buffering), so
 * the same-origin CSRF check is done here.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { APK_MIME, MAX_APK_BYTES, ReleaseError, signUploadToken, storeApkStream } from '@/server/app-releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return Response.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;

  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== APK_MIME) {
    return Response.json({ error: `Upload must be sent as ${APK_MIME}.` }, { status: 415 });
  }
  let fileName = '';
  try {
    fileName = decodeURIComponent(req.headers.get('x-file-name') || '').trim();
  } catch {
    fileName = '';
  }
  fileName = fileName.replace(/[^0-9A-Za-z._ -]/g, '').slice(0, 120);
  if (!fileName.toLowerCase().endsWith('.apk')) {
    return Response.json({ error: 'Choose an .apk file.' }, { status: 415 });
  }
  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > MAX_APK_BYTES) return Response.json({ error: 'The APK is larger than 200 MB.' }, { status: 413 });
  if (!req.body) return Response.json({ error: 'Empty upload.' }, { status: 400 });

  try {
    const { ref, sha256, size } = await storeApkStream(req.body, fileName);
    await audit('app_release.upload', {
      actorId: gate.user.id,
      actorRole: 'SUPER_ADMIN',
      entityType: 'AppRelease',
      after: { fileName, sha256, size },
    });
    const uploadToken = signUploadToken({ ref, sha256, size, fileName, uid: gate.user.id });
    return Response.json({ uploadToken, sha256, fileSize: size, fileName });
  } catch (e) {
    if (e instanceof ReleaseError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
