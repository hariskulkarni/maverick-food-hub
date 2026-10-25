import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assignRider, RiderAssignError } from '@/server/rider-allocator';
import { requireOwnedOrderForAdmin } from '../../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ riderId: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + the order must belong to the caller's restaurant.
  const owned = await requireOwnedOrderForAdmin(id);
  if ('error' in owned) return owned.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'riderId is required' }, { status: 400 });
  try {
    const a = await assignRider(id, parsed.data.riderId);
    return Response.json(a);
  } catch (e) {
    // P1-10: eligibility / state violations carry their own HTTP status.
    if (e instanceof RiderAssignError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
