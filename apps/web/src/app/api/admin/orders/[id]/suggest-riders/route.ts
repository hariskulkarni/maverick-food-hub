import { NextRequest } from 'next/server';
import { suggestRiders } from '@/server/rider-allocator';
import { requireRestaurantAdminApi } from '@/server/api-auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const list = await suggestRiders(id);
  return Response.json(list);
}
