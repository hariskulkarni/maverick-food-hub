/**
 * GET /api/rider/cod — this rider's cash-on-delivery collections.
 *
 * `cashInHand` is the money the rider is currently holding: amounts collected
 * (full or partial) that haven't been reconciled / deposited yet.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const collections = await prisma.codCollection.findMany({
    where: { riderId: profile.id },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { code: true } } },
  });

  // Cash still on the rider: collected (full/partial) but not yet reconciled.
  const cashInHand = collections
    .filter((c) => c.status === 'COLLECTED' || c.status === 'PARTIAL_COLLECTED')
    .reduce((s, c) => s + Number(c.amountCollected ?? 0), 0);

  return Response.json({
    cashInHand: Math.round(cashInHand * 100) / 100,
    collections: collections.map((c) => ({
      id: c.id,
      orderCode: c.order.code,
      amountToCollect: Number(c.amountToCollect),
      amountCollected: c.amountCollected != null ? Number(c.amountCollected) : null,
      status: c.status,
      collectedAt: c.collectedAt?.toISOString() ?? null,
      reconciledAt: c.reconciledAt?.toISOString() ?? null,
      notes: c.notes,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
