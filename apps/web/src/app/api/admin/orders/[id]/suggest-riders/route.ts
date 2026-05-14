import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { suggestRiders } from '@/server/rider-allocator';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const list = await suggestRiders(id);
  return Response.json(list);
}
