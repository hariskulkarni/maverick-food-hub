import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { assignRider } from '@/server/rider-allocator';

const Body = z.object({ riderId: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const body = Body.parse(await req.json());
  const a = await assignRider(id, body.riderId);
  return Response.json(a);
}
