import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireManagedRestaurant } from '@/server/tenancy';
import { auditReview } from '@/server/reviews/review-audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(1500) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const { id } = await params;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const r = await prisma.reviewReplyTemplate.updateMany({ where: { id, restaurantId: restaurant.id }, data: parsed });
    if (r.count === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    await auditReview('reviews.template.update', restaurant.id, { entityType: 'ReviewReplyTemplate', entityId: id, after: { name: parsed.name } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const { id } = await params;
    const r = await prisma.reviewReplyTemplate.deleteMany({ where: { id, restaurantId: restaurant.id } });
    if (r.count === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    await auditReview('reviews.template.delete', restaurant.id, { entityType: 'ReviewReplyTemplate', entityId: id });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
