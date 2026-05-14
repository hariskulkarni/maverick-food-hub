import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return Response.json([]);
  const list = await prisma.riderAssignment.findMany({
    where: { riderId: profile.id, status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } },
    include: { order: { include: { items: true, customer: true, address: true, branch: true } } },
    orderBy: { assignedAt: 'asc' }
  });
  return Response.json(list);
}
