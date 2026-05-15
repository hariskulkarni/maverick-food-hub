/**
 * POST /api/rider/avatar
 * Multipart upload of the rider's profile photo. Stores via the storage driver
 * (same adapter as proof-of-delivery photos — local disk in dev, S3 in prod)
 * and updates User.avatarUrl for the signed-in rider.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Image mime types we accept for an avatar. */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Reasonable upper bound for a profile photo. */
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return new Response('Not found', { status: 404 });

  const form = await req.formData();
  const file = form.get('photo');
  if (!(file instanceof Blob)) return new Response('Missing photo', { status: 400 });

  const type = file.type || 'image/jpeg';
  if (!ALLOWED_TYPES.includes(type.toLowerCase())) {
    return new Response('Unsupported image type', { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new Response('Image too large (max 8 MB)', { status: 400 });
  }

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = (file as File).name ?? 'avatar.jpg';

  const { url } = await storage().put(
    { name, type, data: buf },
    { folder: `rider-avatars/${profile.userId}` }
  );
  await prisma.user.update({ where: { id: profile.userId }, data: { avatarUrl: url } });
  return Response.json({ avatarUrl: url });
}
