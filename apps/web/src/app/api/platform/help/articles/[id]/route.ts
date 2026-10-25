/**
 * GET    /api/platform/help/articles/[id] — one article (full content).
 * PATCH  /api/platform/help/articles/[id] — edit; bumps version + snapshot.
 * DELETE /api/platform/help/articles/[id] — delete (versions + feedback cascade).
 * SUPER_ADMIN only.
 */
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { ArticlePatch, HelpConflictError, deleteArticle, updateArticle } from '@/server/help/authoring';
import { actorOf, articleDto } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const a = await prisma.helpArticle.findUnique({ where: { id: (await params).id } });
  if (!a) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ article: articleDto(a) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const body = parseOrJsonError(ArticlePatch, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  try {
    const a = await updateArticle((await params).id, body, actorOf(gate));
    if (!a) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ article: articleDto(a) });
  } catch (e) {
    if (e instanceof HelpConflictError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const ok = await deleteArticle((await params).id, actorOf(gate));
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ ok: true });
}
