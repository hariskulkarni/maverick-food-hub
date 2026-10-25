import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { tenantAdminOrError } from '@/server/tenancy';
import { auditReview } from '@/server/reviews/review-audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { STARTER_TEMPLATES } from '@/lib/review-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEMPLATES = 30;
const dto = (t: { id: string; name: string; body: string; updatedAt: Date }) => ({ id: t.id, name: t.name, body: t.body, updatedAt: t.updatedAt });

export async function GET(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const rows = await prisma.reviewReplyTemplate.findMany({ where: { restaurantId: restaurant.id }, orderBy: { createdAt: 'asc' } });
    return Response.json({ templates: rows.map(dto) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const Body = z.union([
  z.object({ starter: z.literal(true) }),
  z.object({ name: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(1500) }),
]);

/** Create a template, or `{ starter: true }` to add the starter set. */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const existing = await prisma.reviewReplyTemplate.count({ where: { restaurantId: restaurant.id } });
    const toCreate = 'starter' in parsed ? STARTER_TEMPLATES : [parsed];
    if (existing + toCreate.length > MAX_TEMPLATES) return Response.json({ error: `At most ${MAX_TEMPLATES} templates` }, { status: 400 });
    const created = [];
    for (const t of toCreate) {
      created.push(await prisma.reviewReplyTemplate.create({ data: { restaurantId: restaurant.id, name: t.name, body: t.body } }));
    }
    await auditReview('reviews.template.create', restaurant.id, { entityType: 'ReviewReplyTemplate', after: { names: created.map((c) => c.name) } });
    return Response.json({ templates: created.map(dto) }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
