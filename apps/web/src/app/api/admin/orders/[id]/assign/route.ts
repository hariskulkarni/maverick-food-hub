import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assignRider } from '@/server/rider-allocator';
import { requireRestaurantAdminApi } from '@/server/api-auth';

const Body = z.object({ riderId: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const body = Body.parse(await req.json());
  const a = await assignRider(id, body.riderId);
  return Response.json(a);
}
