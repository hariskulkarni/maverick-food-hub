import { NextRequest } from 'next/server';
import { requireCapabilityApi } from '@/server/api-auth';
import { approveRequest } from '@/server/approvals';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('approvals:review');
  if (gate instanceof Response) return gate;
  const session = gate;
  const { id } = await params;
  const res = await approveRequest(id, { id: session.user.id!, role: (session.user as { role?: string }).role });
  if (!res.ok) return Response.json(res, { status: res.error === 'not_found' ? 404 : 400 });
  return Response.json(res);
}
