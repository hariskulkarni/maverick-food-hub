import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';

const Body = z.object({ otp: z.string().min(4).max(6) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: true } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });
  const { otp } = Body.parse(await req.json());
  if (otp !== a.order.deliveryOtp) return new Response('Invalid OTP', { status: 400 });

  // Mark OTP verified and stamp delivery time on the assignment, then transition the order.
  // Bump rider's lifetime earnings by the assignment total (already set at claim time).
  await prisma.$transaction([
    prisma.order.update({ where: { id: a.order.id }, data: { deliveryOtpVerified: true } }),
    prisma.riderAssignment.update({ where: { id: a.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } }),
    prisma.riderProfile.update({
      where: { id: a.riderId },
      data: { totalEarnings: { increment: a.earningsAmt as any } }
    })
  ]);
  await transitionOrder(a.order.id, 'DELIVERED' as any, { actorId: session.user.id });
  return Response.json({ ok: true });
}
