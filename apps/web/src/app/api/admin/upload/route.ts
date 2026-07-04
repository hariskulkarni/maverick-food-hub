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

/**
 * Read a multipart/form-data body resiliently.
 *
 * Next/undici's built-in `request.formData()` intermittently throws
 * "TypeError: Failed to parse body as FormData" on larger multipart uploads
 * (notably video files) even when the body is intact. We try the native parser
 * first (fast path — covers images), and on failure fall back to a manual,
 * binary-safe parser that reads the raw bytes and splits on the boundary. This
 * makes video uploads reliable without changing the client.
 */
async function readMultipart(req: NextRequest): Promise<FormData> {
  const ct = req.headers.get('content-type') || '';
  const buf = Buffer.from(await req.arrayBuffer());
  let nativeInfo = 'skipped';
  // Try the native parser on a COPY of the buffered body (so `buf` is never
  // touched). Some Next/undici builds either throw OR succeed-but-return-no-file
  // on larger multipart uploads (video), so we only trust it when it actually
  // contains the file; otherwise we fall back to the manual parser on `buf`.
  try {
    const native = await new Response(new Uint8Array(buf), { headers: { 'content-type': ct } }).formData();
    nativeInfo = `keys=[${[...native.keys()].join(',')}]`;
    if (native.get('file') instanceof Blob) {
      log.info({ bytes: buf.length, path: 'native', nativeInfo }, 'upload parsed');
      return native;
    }
  } catch (e) {
    nativeInfo = 'threw:' + ((e as Error)?.message || String(e)).slice(0, 80);
  }
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error(`missing multipart boundary (bytes=${buf.length}, ct=${ct.slice(0, 60)})`);
  const fd = manualParseMultipart(buf, (m[1] || m[2]).trim());
  log.info({ bytes: buf.length, path: 'manual', nativeInfo, manualKeys: [...fd.keys()].join(',') }, 'upload parsed (manual)');
  return fd;
}

function manualParseMultipart(buf: Buffer, boundary: string): FormData {
  const fd = new FormData();
  const delim = Buffer.from(`--${boundary}`);
  const CRLF = Buffer.from('\r\n');
  const HDR_END = Buffer.from('\r\n\r\n');

  let pos = buf.indexOf(delim);
  if (pos < 0) throw new Error('multipart boundary not found in body');
  pos += delim.length;

  while (pos < buf.length) {
    // "--" immediately after a boundary marks the end of the payload.
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;
    // Skip the CRLF that follows the boundary line.
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;

    const next = buf.indexOf(delim, pos);
    if (next < 0) break;

    // Part bytes run up to the CRLF that precedes the next boundary.
    let end = next;
    if (end >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
    const part = buf.subarray(pos, end);

    const sep = part.indexOf(HDR_END);
    if (sep >= 0) {
      const headers = part.subarray(0, sep).toString('utf8');
      const body = part.subarray(sep + HDR_END.length);
      const nameM = headers.match(/name="([^"]*)"/i);
      const fileM = headers.match(/filename="([^"]*)"/i);
      const typeM = headers.match(/content-type:\s*([^\r\n]+)/i);
      const name = nameM ? nameM[1] : '';
      if (name) {
        if (fileM) {
          const file = new File([new Uint8Array(body)], fileM[1] || 'upload.bin', {
            type: typeM ? typeM[1].trim() : 'application/octet-stream',
          });
          fd.append(name, file);
        } else {
          fd.append(name, body.toString('utf8'));
        }
      }
    }
    pos = next + delim.length;
  }
  return fd;
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
    form = await readMultipart(req);
  } catch (e) {
    const detail = (e as Error)?.message || String(e);
    log.error({ err: e }, 'upload: invalid multipart body');
    return jsonError(400, `Upload could not be read: ${detail.slice(0, 160)}`, 'upload/bad_body');
  }

  const file = form.get('file');
  const folder = (form.get('folder') as string | null) ?? 'misc';
  if (!(file instanceof Blob)) {
    const parsedFields = [...form.keys()].join(',') || '(none)';
    const cl = req.headers.get('content-length') ?? '?';
    return jsonError(400, `No file in upload. Parsed fields: [${parsedFields}]; content-length=${cl}.`, 'upload/missing_file');
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
