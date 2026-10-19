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

  // H24: NEVER demote/overwrite an existing privileged account. The public,
  // unauthenticated rider-application create accepts any phone with no ownership
  // proof, and this upsert used to flip whatever user owned that phone to RIDER —
  // submit a SUPER_ADMIN's phone, approve it, and they are locked out of /platform.
  // Allow-list promotion: only an unclaimed phone or an existing CUSTOMER/RIDER may
  // become a rider (allow-list so a future role defaults to non-promotable).
  const existingUser = await prisma.user.findUnique({ where: { phone: app.phone } });
  const PROMOTABLE: Role[] = [Role.CUSTOMER, Role.RIDER];
  if (existingUser && !PROMOTABLE.includes(existingUser.role)) {
    return new Response(
      'That phone already belongs to a non-rider account and cannot be approved as a rider.',
      { status: 409 }
    );
  }
  const user = existingUser
    ? await prisma.user.update({ where: { id: existingUser.id }, data: { role: Role.RIDER, name: existingUser.name ?? app.name } })
    : await prisma.user.create({ data: { phone: app.phone, name: app.name, role: Role.RIDER } });
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
