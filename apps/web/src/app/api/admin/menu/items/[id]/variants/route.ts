import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedItem, serializeVariant } from './_helpers';

const Create = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  isDefault: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await requireOwnedItem(id);
  if ('error' in owned) return owned.error;
  const variants = await prisma.menuItemVariant.findMany({
    where: { menuItemId: owned.itemId },
    orderBy: { sortOrder: 'asc' },
  });
  return Response.json(variants.map(serializeVariant));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await requireOwnedItem(id);
  if ('error' in owned) return owned.error;
  const data = Create.parse(await req.json());

  const variant = await prisma.$transaction(async (tx) => {
    // A new default demotes any existing default so exactly one applies.
    if (data.isDefault) {
      await tx.menuItemVariant.updateMany({
        where: { menuItemId: owned.itemId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.menuItemVariant.create({
      data: {
        menuItemId: owned.itemId,
        name: data.name,
        price: data.price as any,
        isDefault: data.isDefault ?? false,
        isAvailable: data.isAvailable ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  });
  return Response.json(serializeVariant(variant));
}
