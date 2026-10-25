/**
 * POST /api/rider/incidents/photo
 *
 * Multipart upload (field `photo`) of an incident-report photo for the signed-in
 * rider (Bearer auth via rider-auth). Same storage driver and limits as the
 * rider avatar upload. Returns `{ url }`, which the client then sends as
 * `photoUrl` on POST /api/rider/incidents.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';
import { rateLimit } from '@/server/http/rate-limit';
import { incidentPhotoFolder } from '@/server/rider-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const rl = await rateLimit(req, { name: 'rider-incident-photo', limit: 20, windowMs: 60 * 60_000, key: profile.id, ignoreIp: true });
  if (!rl.ok) return rl.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Could not read the upload.' }, { status: 400 });
  }
  const file = form.get('photo');
  if (!(file instanceof Blob)) return Response.json({ error: 'Missing photo.' }, { status: 400 });

  const type = (file.type || 'image/jpeg').toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) return Response.json({ error: 'Unsupported image type.' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'Image too large (max 8 MB).' }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name || 'incident.jpg';
  const { url } = await storage().put({ name, type, data }, { folder: incidentPhotoFolder(profile.id) });
  return Response.json({ url }, { status: 201 });
}
