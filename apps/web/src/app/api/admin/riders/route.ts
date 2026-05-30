import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { requireRestaurant } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';

const Body = z.object({
  name: z.string().min(2),
  phone: z.string().min(8).max(20),
  branchId: z.string(),
  vehicleType: z.string().default('BIKE'),
  vehicleNumber: z.string().optional()
});

export async function POST(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  const branch = await prisma.branch.findFirst({ where: { id: data.branchId, restaurantId: restaurant.id } });
  if (!branch) return new Response('Branch not in your restaurant', { status: 403 });

  // Create or upgrade the user, then attach a rider profile
  const user = await prisma.user.upsert({
    where: { phone: data.phone },
    update: { role: Role.RIDER, name: data.name },
    create: { phone: data.phone, name: data.name, role: Role.RIDER }
  });
  const profile = await prisma.riderProfile.upsert({
    where: { userId: user.id },
    update: { branchId: data.branchId, vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber },
    create: { userId: user.id, branchId: data.branchId, vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber }
  });
  return Response.json({ riderId: profile.id, userId: user.id });
}
