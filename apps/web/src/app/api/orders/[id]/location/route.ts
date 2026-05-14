import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({
    where: { id },
    include: { assignment: { include: { rider: true } } }
  });
  if (!order) return new Response('Not found', { status: 404 });
  // Customers can only see their own orders; admins/kitchen/riders can see any (admin scoping done elsewhere).
  if (session.user.role === 'CUSTOMER' && order.customerId !== session.user.id) {
    return new Response('Forbidden', { status: 403 });
  }
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
