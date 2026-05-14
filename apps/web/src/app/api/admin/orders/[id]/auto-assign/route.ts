import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { autoAssign } from '@/server/rider-allocator';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await autoAssign(id);
  if (!r) return new Response('No rider available', { status: 409 });
  return Response.json(r);
}
