import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { isDemoMode } from '@/lib/demo';
import { maskPhone } from '@/server/telephony/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
          // P0-3: only what the rider needs to reach the customer — never the
          // full User row (passwordHash, totpSecret, email, …). The phone is
          // read ONLY to build the masked "+91 ******12" hint below; riders
          // call through POST …/call-customer (masked via Exotel).
          customer: { select: { id: true, name: true, phone: true } },
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
  // The hand-over code is the customer's proof of receipt — the rider must get
  // it FROM the customer, so it is only exposed on demo deployments (where the
  // app shows a "DEMO MODE" hint for walkthroughs).
  const demo = isDemoMode();
  const out = list.map((a) => ({
    ...a,
    order: {
      ...a.order,
      deliveryOtp: demo ? a.order.deliveryOtp : null,
      // Never the real number — name + masked hint only (masked calling).
      customer: a.order.customer
        ? { id: a.order.customer.id, name: a.order.customer.name, maskedPhone: maskPhone(a.order.customer.phone) }
        : null,
      pickupCode: undefined,
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
