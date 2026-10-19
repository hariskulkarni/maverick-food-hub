import { NextRequest } from 'next/server';
import { autoAssign } from '@/server/rider-allocator';
import { requireOwnedOrderForAdmin } from '../../_helpers';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + the order must belong to the caller's restaurant.
  const owned = await requireOwnedOrderForAdmin(id);
  if ('error' in owned) return owned.error;
  const r = await autoAssign(id);
  if (!r) {
    return Response.json(
      { error: 'No rider is available right now. Try again or assign manually.', reason: 'no_rider_available' },
      { status: 409 }
    );
  }
  return Response.json(r);
}
