/** GET /api/platform/help/articles/[id]/versions — version history, newest first. SUPER_ADMIN only. */
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const versions = await prisma.helpArticleVersion.findMany({
    where: { articleId: (await params).id },
    orderBy: { version: 'desc' },
  });
  return Response.json({
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      summary: v.summary,
      body: v.body,
      audience: v.audience,
      tags: v.tags,
      appArea: v.appArea,
      note: v.note,
      authorName: v.authorName,
      authorId: v.authorId,
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
