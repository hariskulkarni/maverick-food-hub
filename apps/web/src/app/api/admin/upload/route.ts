/**
 * POST /api/admin/upload
 *
 * Multipart upload accepted from any authenticated admin / super-admin /
 * kitchen user. Routes through the storage driver (local in dev, S3 from
 * integration creds in prod).
 *
 * On success → 200 with `{ url, key }`.
 * On failure → 4xx/5xx with `{ error, code }` so the client can show a
 *              targeted message AND act on the code (re-login on 401,
 *              etc.). The shared `api-auth.ts` helpers guarantee the same
 *              shape across every admin endpoint.
 *
 * Body: multipart/form-data with
 *   - `file`     (required) — single image blob
 *   - `folder`   (optional path prefix, default "misc")
 */
import { NextRequest } from 'next/server';
import { storage } from '@/server/storage';
import { requireAnyAdminApi } from '@/server/api-auth';
import { log } from '@/server/log';

export const runtime = 'nodejs';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB — hero/carousel video slides
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);

function jsonError(status: number, error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  // Auth gate — returns a typed 401/403 JSON response when the caller can't
  // hit this endpoint. The check distinguishes "not signed in" (the client
  // should re-login) from "wrong role" (the client should show a permission
  // message). This is the single most important UX fix vs the old bare
  // "Forbidden" text response.
  const gate = await requireAnyAdminApi();
  if (gate instanceof Response) {
    // Log the rejected attempt with whatever context we have. Helps when an
    // admin reports "upload broken" — we can see if it was 401 (their
    // session expired) or 403 (their role is wrong).
    log.warn(
      { status: gate.status, route: '/api/admin/upload' },
      'upload denied at auth gate',
    );
    return gate;
  }
  const session = gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    log.error({ err: e }, 'upload: invalid multipart body');
    return jsonError(400, 'Upload payload was not a valid multipart form.', 'upload/bad_body');
  }

  const file = form.get('file');
  const folder = (form.get('folder') as string | null) ?? 'misc';
  if (!(file instanceof Blob)) {
    return jsonError(400, 'No file attached to the upload.', 'upload/missing_file');
  }
  if (file.size === 0) {
    return jsonError(400, 'The uploaded file is empty.', 'upload/empty_file');
  }

  const type = file.type || 'application/octet-stream';
  const isVideo = ALLOWED_VIDEO.has(type);
  const isImage = ALLOWED_IMAGE.has(type);
  if (!isVideo && !isImage) {
    return jsonError(
      415,
      `Unsupported file type "${type}". Upload an image (JPEG, PNG, WebP, GIF, AVIF) or a video (MP4, WebM, MOV, OGG).`,
      'upload/bad_type',
    );
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return jsonError(
      413,
      `File is too large — max ${maxBytes / 1024 / 1024} MB for ${isVideo ? 'video' : 'image'}.`,
      'upload/too_large',
    );
  }

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = (file as File).name || 'upload.bin';
  // Whitelist the folder slug — letters, digits, slash, underscore, dash only.
  // Anything else is silently stripped so an editor can't accidentally write
  // outside the uploads tree (e.g. by entering "../something").
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '') || 'misc';

  try {
    const { url, key } = await storage().put(
      { name, type, data: buf },
      { folder: safeFolder },
    );
    log.info(
      {
        actorId: session.user.id,
        actorRole: session.user.role,
        size: buf.length,
        type,
        folder: safeFolder,
        key,
      },
      'upload succeeded',
    );
    return Response.json({ url, key });
  } catch (e) {
    log.error(
      {
        err: e,
        actorId: session.user.id,
        actorRole: session.user.role,
        size: buf.length,
        folder: safeFolder,
      },
      'upload: storage driver threw',
    );
    return jsonError(
      500,
      'The file could not be saved. Please try again — if it keeps failing, contact support.',
      'upload/storage_error',
    );
  }
}
