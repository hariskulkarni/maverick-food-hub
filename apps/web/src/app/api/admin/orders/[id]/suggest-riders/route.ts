import { NextRequest } from 'next/server';
import { suggestRiders } from '@/server/rider-allocator';
import { requireOwnedOrderForAdmin } from '../../_helpers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + the order must belong to the caller's restaurant.
  const owned = await requireOwnedOrderForAdmin(id);
  if ('error' in owned) return owned.error;
  const list = await suggestRiders(id);
  return Response.json(list);
}
