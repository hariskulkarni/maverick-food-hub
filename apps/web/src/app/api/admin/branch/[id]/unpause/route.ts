import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { tenantAdminOrError } from '@/server/tenancy';
import { unpauseBranch, isPaused } from '@/server/branch-pause';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Admin-only (kitchen UI never calls this) — membership-role gate.
  const restaurant = await tenantAdminOrError();
  if (restaurant instanceof Response) return restaurant;
  const { id } = await params;

  const branch = await prisma.branch.findFirst({ where: { id, restaurantId: restaurant.id } });
  if (!branch) return new Response('Not found', { status: 404 });

  await unpauseBranch(id);
  const status = await isPaused(id);
  return Response.json({ ok: true, ...status });
}
