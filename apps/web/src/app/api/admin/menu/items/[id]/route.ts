import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';

const Patch = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  price: z.number().optional(),
  categoryId: z.string().optional(),
  isVeg: z.boolean().optional(),
  spicyLevel: z.number().optional(),
  prepTimeMin: z.number().optional(),
  imageUrl: z.string().optional().nullable(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  branchId: z.string().optional(),
  reason: z.string().optional().nullable()
}).strict().partial();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const parsed = Patch.parse(await req.json());
  const { reason, ...data } = parsed;

  // Snapshot the existing availability so we can detect a true flip.
  const before = await prisma.menuItem.findUnique({
    where: { id },
    select: {
      id: true, name: true, isAvailable: true,
      branch: {
        select: {
          id: true, name: true, restaurantId: true,
          restaurant: { select: { id: true, name: true } }
        }
      }
    }
  });

  const u = await prisma.menuItem.update({
    where: { id },
    data: { ...data, ...(data.price != null ? { price: data.price as any } : {}) }
  });

  // Alert hook — only fire when isAvailable actually flipped. Runs after the
  // mutation commits and is fully suppressed if the mail layer throws so a
  // bad SMTP config can never roll back this PATCH.
  if (before && data.isAvailable !== undefined && before.isAvailable !== data.isAvailable) {
    const restaurantId = before.branch?.restaurantId;
    const restaurantName = before.branch?.restaurant?.name ?? '';
    if (restaurantId) {
      sendMenuToggleAlert({
        restaurantId,
        kind: 'item',
        entityType: 'MenuItem',
        entityId: id,
        entityName: before.name,
        restaurantName,
        branchName: before.branch?.name ?? null,
        actorName: session.user.name ?? session.user.email ?? null,
        actorEmail: session.user.email ?? null,
        actorRole: session.user.role,
        oldStatus: before.isAvailable ? 'Enabled' : 'Disabled',
        newStatus: data.isAvailable ? 'Enabled' : 'Disabled',
        reason: reason ?? null,
        timestamp: new Date(),
        detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu#item-${id}`
      }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(item) failed'));
    }
  }

  return Response.json(u);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  await prisma.menuItem.delete({ where: { id } });
  return Response.json({ ok: true });
}
