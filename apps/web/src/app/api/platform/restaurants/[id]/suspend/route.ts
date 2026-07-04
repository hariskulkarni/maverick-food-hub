import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const r = await prisma.restaurant.update({ where: { id }, data: { status: 'SUSPENDED' } });
  revalidateRestaurantSurfaces(r.slug);
  return Response.json(r);
}
