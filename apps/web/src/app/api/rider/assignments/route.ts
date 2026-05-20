import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return Response.json([]);
  const list = await prisma.riderAssignment.findMany({
    where: { riderId: profile.id, status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } },
    include: {
      order: {
        include: {
          items: true,
          customer: true,
          address: true,
          // Include the branch's restaurant so each assignment carries the
          // SOURCE restaurant the rider must collect from — critical once
          // riders are shared across a group and a rider's active deliveries
          // can span several restaurants.
          branch: { include: { restaurant: { select: { id: true, name: true } } } }
        }
      }
    },
    orderBy: { assignedAt: 'asc' }
  });

  // Surface the source restaurant name/id on each order's branch so the native
  // app can show "which restaurant" prominently. (Prisma already nests it under
  // branch.restaurant; we keep the shape flat-and-explicit for the client.)
  const out = list.map((a) => ({
    ...a,
    order: {
      ...a.order,
      branch: a.order.branch
        ? {
            ...a.order.branch,
            restaurantId: a.order.branch.restaurant?.id ?? null,
            restaurantName: a.order.branch.restaurant?.name ?? null
          }
        : a.order.branch
    }
  }));
  return Response.json(out);
}
