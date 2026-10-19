import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assignRider } from '@/server/rider-allocator';
import { requireOwnedOrderForAdmin } from '../../_helpers';

const Body = z.object({ riderId: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + the order must belong to the caller's restaurant.
  const owned = await requireOwnedOrderForAdmin(id);
  if ('error' in owned) return owned.error;
  const body = Body.parse(await req.json());
  const a = await assignRider(id, body.riderId);
  return Response.json(a);
}
