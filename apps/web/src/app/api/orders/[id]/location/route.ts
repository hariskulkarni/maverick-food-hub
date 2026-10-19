import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { currentRestaurant } from '@/server/tenancy';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({
    where: { id },
    include: { assignment: { include: { rider: true } }, branch: { select: { restaurantId: true } } }
  });
  if (!order) return new Response('Not found', { status: 404 });
  // H4: scope by role. Previously only CUSTOMER was ownership-checked and every
  // other role could read any order's 200-point GPS trail across all tenants.
  const role = session.user.role;
  let allowed = false;
  if (role === 'CUSTOMER') {
    allowed = order.customerId === session.user.id;
  } else if (role === 'SUPER_ADMIN') {
    allowed = true;
  } else if (role === 'ADMIN' || role === 'KITCHEN') {
    const r = await currentRestaurant();
    allowed = !!r && order.branch.restaurantId === r.id;
  } else if (role === 'RIDER') {
    allowed = order.assignment?.rider?.userId === session.user.id;
  }
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const pings = await prisma.deliveryLocationPing.findMany({
    where: { orderId: id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { lat: true, lng: true }
  });
  const rider = order.assignment?.rider;
  return Response.json({
    rider: rider?.currentLat != null && rider?.currentLng != null ? { lat: rider.currentLat, lng: rider.currentLng } : null,
    trail: pings
  });
}
