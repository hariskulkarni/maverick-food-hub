/** POST /api/platform/help/articles/[id]/publish { published: boolean } — publish / unpublish. SUPER_ADMIN only. */
import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { setPublished } from '@/server/help/authoring';
import { actorOf, articleDto } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ published: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const body = parseOrJsonError(Body, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  const a = await setPublished((await params).id, body.published, actorOf(gate));
  if (!a) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ article: articleDto(a) });
}
