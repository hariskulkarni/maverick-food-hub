/**
 * POST /api/rider/assignments/[id]/photo
 * Multipart upload of proof-of-delivery photo. Stores via storage driver
 * and updates RiderAssignment.deliveryPhotoUrl.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  const form = await req.formData();
  const file = form.get('photo');
  if (!(file instanceof Blob)) return new Response('Missing photo', { status: 400 });
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = (file as File).name ?? 'delivery.jpg';
  const type = file.type || 'image/jpeg';

  const { url } = await storage().put({ name, type, data: buf }, { folder: `delivery-photos/${a.orderId}` });
  await prisma.riderAssignment.update({ where: { id }, data: { deliveryPhotoUrl: url } });
  return Response.json({ url });
}
