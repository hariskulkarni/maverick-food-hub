import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { requireRestaurant } from '@/server/tenancy';
import { notify } from '@/server/notifications';
import { brand } from '@/lib/brand';

const Body = z.object({ branchId: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const { branchId } = Body.parse(await req.json());

  const app = await prisma.riderApplication.findUnique({ where: { id } });
  if (!app || app.restaurantId !== restaurant.id) return new Response('Not found', { status: 404 });
  if (app.status !== 'PENDING') return new Response('Already reviewed', { status: 409 });

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId: restaurant.id } });
  if (!branch) return new Response('Branch not in your restaurant', { status: 403 });

  // Promote → User + RiderProfile
  const user = await prisma.user.upsert({
    where: { phone: app.phone },
    update: { role: Role.RIDER, name: app.name },
    create: { phone: app.phone, name: app.name, role: Role.RIDER }
  });
  await prisma.riderProfile.upsert({
    where: { userId: user.id },
    update: { branchId, vehicleType: app.vehicleType, vehicleNumber: app.vehicleNumber },
    create: { userId: user.id, branchId, vehicleType: app.vehicleType, vehicleNumber: app.vehicleNumber }
  });
  await prisma.riderApplication.update({
    where: { id },
    data: { status: 'APPROVED', reviewedAt: new Date() }
  });

  await notify.sms({
    to: app.phone,
    userId: user.id,
    template: 'rider.approved',
    body: `${brand.name}: You're approved to ride for ${restaurant.name}. Sign in at ${process.env.NEXTAUTH_URL ?? '/'}/login`
  });

  return Response.json({ ok: true });
}
