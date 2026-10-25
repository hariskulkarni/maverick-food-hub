/**
 * GET  /api/platform/help/categories — all categories with article counts.
 * POST /api/platform/help/categories — create a category.
 * SUPER_ADMIN only.
 */
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { CategoryInput } from '@/server/help/authoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const rows = await prisma.helpCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    include: { _count: { select: { articles: true } } },
  });
  return Response.json({
    categories: rows.map((c) => ({
      id: c.id, slug: c.slug, title: c.title, description: c.description,
      audience: c.audience, sortOrder: c.sortOrder, articleCount: c._count.articles,
    })),
  });
}

export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const body = parseOrJsonError(CategoryInput, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  if (await prisma.helpCategory.findUnique({ where: { slug: body.slug }, select: { id: true } })) {
    return Response.json({ error: `Category "${body.slug}" already exists.` }, { status: 409 });
  }
  const c = await prisma.helpCategory.create({ data: { ...body, description: body.description ?? null } });
  await audit('help.category.create', { actorId: gate.user.id, actorRole: gate.user.role, entityType: 'HelpCategory', entityId: c.id, after: body });
  return Response.json({ category: { id: c.id, slug: c.slug, title: c.title, description: c.description, audience: c.audience, sortOrder: c.sortOrder, articleCount: 0 } }, { status: 201 });
}
