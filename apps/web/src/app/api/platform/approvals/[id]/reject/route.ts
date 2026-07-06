import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCapabilityApi } from '@/server/api-auth';
import { rejectRequest } from '@/server/approvals';

const Body = z.object({ note: z.string().max(300).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('approvals:review');
  if (gate instanceof Response) return gate;
  const session = gate;
  const { id } = await params;
  let note: string | undefined;
  try { note = Body.parse(await req.json().catch(() => ({}))).note; } catch { note = undefined; }
  const res = await rejectRequest(id, { id: session.user.id!, role: (session.user as { role?: string }).role }, note);
  if (!res.ok) return Response.json(res, { status: res.error === 'not_found' ? 404 : 400 });
  return Response.json(res);
}
