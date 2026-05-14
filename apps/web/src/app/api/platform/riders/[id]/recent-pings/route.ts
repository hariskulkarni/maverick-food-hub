import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

/**
 * Super-admin: returns the rider's most recent GPS pings, newest first.
 * Used by the live tracking side panel to draw a breadcrumb trail.
 *   limit defaults to 50, capped at 500.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id: riderId } = await params;
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? 50);
  const limit = Math.min(500, Math.max(1, isFinite(limitParam) ? limitParam : 50));

  const pings = await prisma.deliveryLocationPing.findMany({
    where: { riderId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, lat: true, lng: true, speedKph: true, createdAt: true, orderId: true }
  });

  return Response.json(pings);
}
