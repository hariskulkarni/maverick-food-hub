import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  try {
    await prisma.category.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: 'Category still has items or is referenced elsewhere — remove its items first.', reason: 'in_use' },
      { status: 409 }
    );
  }
}
