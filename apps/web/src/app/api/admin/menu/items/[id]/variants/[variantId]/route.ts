import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedVariant, serializeVariant } from '../_helpers';

const Patch = z.object({
  name: z.string().min(1).optional(),
  price: z.number().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const { id, variantId } = await params;
  const owned = await requireOwnedVariant(id, variantId);
  if ('error' in owned) return owned.error;
  const data = Patch.parse(await req.json());

  const variant = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      // Demote sibling defaults so exactly one variant stays default.
      const v = await tx.menuItemVariant.findUnique({
        where: { id: owned.variantId },
        select: { menuItemId: true },
      });
      if (v) {
        await tx.menuItemVariant.updateMany({
          where: { menuItemId: v.menuItemId, isDefault: true, NOT: { id: owned.variantId } },
          data: { isDefault: false },
        });
      }
    }
    return tx.menuItemVariant.update({
      where: { id: owned.variantId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.price !== undefined ? { price: data.price as any } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.isAvailable !== undefined ? { isAvailable: data.isAvailable } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
  });
  return Response.json(serializeVariant(variant));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const { id, variantId } = await params;
  const owned = await requireOwnedVariant(id, variantId);
  if ('error' in owned) return owned.error;
  await prisma.menuItemVariant.delete({ where: { id: owned.variantId } });
  return Response.json({ ok: true });
}
