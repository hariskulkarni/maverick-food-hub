/**
 * PATCH  /api/platform/help/categories/[id] — edit a category.
 * DELETE /api/platform/help/categories/[id] — delete; its articles become uncategorised.
 * SUPER_ADMIN only.
 */
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { CategoryInput } from '@/server/help/authoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const body = parseOrJsonError(CategoryInput.partial(), await req.json().catch(() => null));
  if (body instanceof Response) return body;
  const id = (await params).id;
  const before = await prisma.helpCategory.findUnique({ where: { id } });
  if (!before) return Response.json({ error: 'Not found' }, { status: 404 });
  if (body.slug && body.slug !== before.slug && (await prisma.helpCategory.findUnique({ where: { slug: body.slug } }))) {
    return Response.json({ error: `Category "${body.slug}" already exists.` }, { status: 409 });
  }
  const c = await prisma.helpCategory.update({ where: { id }, data: body });
  await audit('help.category.update', { actorId: gate.user.id, actorRole: gate.user.role, entityType: 'HelpCategory', entityId: id, before, after: body });
  return Response.json({ category: { id: c.id, slug: c.slug, title: c.title, description: c.description, audience: c.audience, sortOrder: c.sortOrder } });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const id = (await params).id;
  const before = await prisma.helpCategory.findUnique({ where: { id } });
  if (!before) return Response.json({ error: 'Not found' }, { status: 404 });
  await prisma.helpCategory.delete({ where: { id } });
  await audit('help.category.delete', { actorId: gate.user.id, actorRole: gate.user.role, entityType: 'HelpCategory', entityId: id, before });
  return Response.json({ ok: true });
}
