import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

/**
 * Recent NotificationLog entries that are addressed to users of this
 * restaurant's orders (customers + rider) or to the restaurant's staff.
 *
 * Filters (all optional):
 *   - channel:  SMS | WHATSAPP | EMAIL | PUSH
 *   - status:   QUEUED | SENT | FAILED
 *   - q:        substring search on `to`, `subject`, or `body`
 *   - limit:    1..200 (default 50)
 */
export async function GET(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') || undefined;
  const status  = url.searchParams.get('status')  || undefined;
  const q       = url.searchParams.get('q')       || undefined;
  const limit   = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

  // Build the set of users tied to this restaurant: customers who've ordered from any branch +
  // riders who've been assigned to its orders + staff members.
  const branches = await prisma.branch.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
  const branchIds = branches.map((b) => b.id);

  const [customerUserIds, riderUserIds, staffUserIds] = await Promise.all([
    prisma.order.findMany({ where: { branchId: { in: branchIds } }, distinct: ['customerId'], select: { customerId: true } }).then((rows) => rows.map((r) => r.customerId)),
    prisma.order.findMany({ where: { branchId: { in: branchIds }, assignment: { isNot: null } }, select: { assignment: { select: { rider: { select: { userId: true } } } } } })
      .then((rows) => rows.map((r) => r.assignment?.rider?.userId).filter((x): x is string => !!x)),
    prisma.restaurantUser.findMany({ where: { restaurantId: restaurant.id }, select: { userId: true } }).then((rows) => rows.map((r) => r.userId))
  ]);
  const userIds = Array.from(new Set([...customerUserIds, ...riderUserIds, ...staffUserIds]));

  const logs = await prisma.notificationLog.findMany({
    where: {
      userId: { in: userIds },
      ...(channel ? { channel: channel as any } : {}),
      ...(status  ? { status:  status  as any } : {}),
      ...(q ? {
        OR: [
          { to:      { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
          { body:    { contains: q, mode: 'insensitive' } }
        ]
      } : {})
    },
    include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  return Response.json(logs);
}
