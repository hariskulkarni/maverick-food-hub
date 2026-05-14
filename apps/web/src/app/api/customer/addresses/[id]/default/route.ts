/**
 * Mark an address as the user's default.
 * Clears the previous default in the same transaction so there's no window
 * where the user has zero (or two) defaults.
 */

import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const a = await prisma.address.findUnique({ where: { id } });
  if (!a || a.userId !== session.user.id) return new Response('Not found', { status: 404 });

  await prisma.$transaction([
    prisma.address.updateMany({
      where: { userId: session.user.id, isDefault: true, NOT: { id } },
      data: { isDefault: false }
    }),
    prisma.address.update({ where: { id }, data: { isDefault: true } })
  ]);
  return Response.json({ ok: true });
}
