import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';

const Body = z.object({
  name: z.string().min(2),
  phone: z.string().min(8).max(20),
  branchId: z.string(),
  vehicleType: z.string().default('BIKE'),
  vehicleNumber: z.string().optional()
});

export async function POST(req: NextRequest) {
  // Creating riders (and changing a user's role) is an ADMIN action, not KITCHEN.
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  const branch = await prisma.branch.findFirst({ where: { id: data.branchId, restaurantId: restaurant.id } });
  if (!branch) return new Response('Branch not in your restaurant', { status: 403 });

  // Create or upgrade the user, then attach a rider profile. Same allow-list as
  // rider-application approval (H24): never flip an ADMIN/KITCHEN/SUPER_ADMIN
  // account (possibly another restaurant's) to RIDER just by knowing its phone.
  const existing = await prisma.user.findUnique({ where: { phone: data.phone }, select: { id: true, role: true } });
  const PROMOTABLE: Role[] = [Role.CUSTOMER, Role.RIDER];
  if (existing && !PROMOTABLE.includes(existing.role)) {
    return new Response('That phone already belongs to a non-rider account and cannot be added as a rider.', { status: 409 });
  }
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { role: Role.RIDER, name: data.name } })
    : await prisma.user.create({ data: { phone: data.phone, name: data.name, role: Role.RIDER } });
  const profile = await prisma.riderProfile.upsert({
    where: { userId: user.id },
    update: { branchId: data.branchId, vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber },
    create: { userId: user.id, branchId: data.branchId, vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber }
  });
  return Response.json({ riderId: profile.id, userId: user.id });
}
