/**
 * GET  /api/admin/dedicated-riders
 * POST /api/admin/dedicated-riders
 *
 * GET  — lists the RiderProfile records currently DEDICATED to this
 *        restaurant (resolved from the ADMIN's session).
 * POST — { phone } — finds the APPROVED RiderProfile whose user.phone
 *        matches and dedicates them to this restaurant. Returns clear
 *        errors for: not found, not approved, already dedicated elsewhere.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(r: any) {
  return {
    id: r.id,
    name: r.user?.name ?? null,
    phone: r.user?.phone ?? null,
    isOnline: r.isOnline,
    rating: r.rating,
    totalDeliveries: r.totalDeliveries,
    vehicleType: r.vehicleType ?? null,
    vehicleNumber: r.vehicleNumber ?? null,
    approvedAt: r.approvedAt
  };
}

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  const riders = await prisma.riderProfile.findMany({
    where: { riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    include: { user: { select: { name: true, phone: true } } },
    orderBy: [{ isOnline: 'desc' }, { totalDeliveries: 'desc' }]
  });

  return Response.json({ riders: riders.map(serialize) });
}

const PostBody = z.object({
  phone: z.string().trim().min(4).max(20)
});

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  let data;
  try {
    data = PostBody.parse(await req.json());
  } catch {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 });
  }

  // Normalise: compare on the trimmed phone string.
  const phone = data.phone.trim();

  const profile = await prisma.riderProfile.findFirst({
    where: { user: { phone } },
    include: { user: { select: { name: true, phone: true } } }
  });

  if (!profile) {
    return Response.json(
      { error: `No rider found with phone ${phone}. They must register on the platform first.` },
      { status: 404 }
    );
  }

  if (!profile.approvedAt) {
    return Response.json(
      { error: 'This rider has not been approved by the platform yet.' },
      { status: 409 }
    );
  }

  if (
    profile.riderType === 'DEDICATED' &&
    profile.dedicatedRestaurantId &&
    profile.dedicatedRestaurantId !== restaurant.id
  ) {
    return Response.json(
      { error: 'This rider is already dedicated to another restaurant.' },
      { status: 409 }
    );
  }

  if (profile.riderType === 'DEDICATED' && profile.dedicatedRestaurantId === restaurant.id) {
    return Response.json(
      { error: 'This rider is already dedicated to your restaurant.' },
      { status: 409 }
    );
  }

  const updated = await prisma.riderProfile.update({
    where: { id: profile.id },
    data: { riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    include: { user: { select: { name: true, phone: true } } }
  });

  return Response.json({ rider: serialize(updated) }, { status: 201 });
}
