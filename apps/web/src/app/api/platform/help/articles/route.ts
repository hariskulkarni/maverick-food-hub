/**
 * GET  /api/platform/help/articles — every article (all statuses/languages) for the authoring console.
 * POST /api/platform/help/articles — create an article (DRAFT unless `publish: true`); writes version 1.
 * SUPER_ADMIN only.
 */
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { ArticleInput, HelpConflictError, createArticle } from '@/server/help/authoring';
import { actorOf, articleDto } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const rows = await prisma.helpArticle.findMany({
    orderBy: [{ updatedAt: 'desc' }],
    include: { _count: { select: { feedback: true } } },
  });
  return Response.json({ articles: rows.map((r) => ({ ...articleDto(r), feedbackCount: r._count.feedback })) });
}

const Body = ArticleInput.extend({ publish: z.boolean().optional() });

export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const body = parseOrJsonError(Body, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  const { publish, ...input } = body;
  try {
    const a = await createArticle(input, actorOf(gate), { publish });
    return Response.json({ article: articleDto(a) }, { status: 201 });
  } catch (e) {
    if (e instanceof HelpConflictError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
