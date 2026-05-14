/**
 * POST /api/admin/upload
 * Multipart upload accepted from any authenticated admin / restaurant member.
 * Routes through the storage driver (local in dev, S3 from integration creds
 * in prod). Returns { url }.
 *
 * Body: multipart/form-data with one of:
 *   - `file` (single)
 *   - `folder` (optional path prefix, default "uploads")
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { storage } from '@/server/storage';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  // Admins (restaurant) and super-admins can upload. Customers/riders use the
  // narrower delivery-photo endpoint.
  if (!['ADMIN', 'SUPER_ADMIN', 'KITCHEN'].includes(session.user.role as string)) {
    return new Response('Forbidden', { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const folder = (form.get('folder') as string | null) ?? 'uploads';
  if (!(file instanceof Blob)) return new Response('Missing file', { status: 400 });
  if (file.size > MAX_BYTES) return new Response(`File too large (max ${MAX_BYTES / 1024 / 1024} MB)`, { status: 413 });

  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.has(type)) {
    return new Response(`Unsupported type ${type}. Use JPEG, PNG, WebP, GIF, or AVIF.`, { status: 415 });
  }

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = (file as File).name || 'upload.bin';
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '');

  const { url, key } = await storage().put({ name, type, data: buf }, { folder: safeFolder });
  return Response.json({ url, key });
}
