/**
 * POST /api/uploads — customer-facing image upload (order-feedback photos).
 *
 * The feedback dialog (apps/web/src/app/(customer)/orders/feedback-dialog.tsx)
 * uploads here. This mirrors /api/admin/upload's validation + storage flow, but:
 *   • authenticates the CUSTOMER session (any signed-in user) instead of an
 *     admin/kitchen/super role, and
 *   • force-scopes every file under feedback/<userId>/ — the client-supplied
 *     folder is ignored, so a customer can never write elsewhere in /uploads.
 *
 * Returns { url, key } (the shape <ImageUploader> expects).
 */
import { NextRequest } from 'next/server';
import { storage } from '@/server/storage';
import { auth } from '@/server/auth';
import { log } from '@/server/log';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

function jsonError(status: number, error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, 'Please sign in to upload a photo.', 'upload/unauthenticated');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'Upload payload was not a valid multipart form.', 'upload/bad_body');
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) return jsonError(400, 'No file attached to the upload.', 'upload/missing_file');
  if (file.size === 0) return jsonError(400, 'The uploaded file is empty.', 'upload/empty_file');
  if (file.size > MAX_BYTES) {
    return jsonError(413, `File is too large — max ${MAX_BYTES / 1024 / 1024} MB.`, 'upload/too_large');
  }

  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.has(type)) {
    return jsonError(415, `Unsupported file type "${type}". Please upload JPEG, PNG, WebP, GIF, or AVIF.`, 'upload/bad_type');
  }

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = (file as File).name || 'upload.bin';
  // Force a per-customer feedback folder; ignore any client-supplied folder so a
  // customer can never write outside their own feedback tree.
  const folder = `feedback/${session.user.id}`;

  try {
    const { url, key } = await storage().put({ name, type, data: buf }, { folder });
    log.info({ actorId: session.user.id, size: buf.length, type, key }, 'customer feedback upload succeeded');
    return Response.json({ url, key });
  } catch (e) {
    log.error({ err: e, actorId: session.user.id, size: buf.length }, 'customer upload: storage driver threw');
    return jsonError(500, 'The file could not be saved. Please try again.', 'upload/storage_error');
  }
}
