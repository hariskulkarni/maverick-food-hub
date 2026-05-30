import { NextRequest } from 'next/server';
import { autoAssign } from '@/server/rider-allocator';
import { requireRestaurantAdminApi } from '@/server/api-auth';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await autoAssign(id);
  if (!r) {
    return Response.json(
      { error: 'No rider is available right now. Try again or assign manually.', reason: 'no_rider_available' },
      { status: 409 }
    );
  }
  return Response.json(r);
}
