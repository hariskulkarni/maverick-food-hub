import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedItem, serializeGroup } from '../variants/_helpers';

const Create = z.object({
  name: z.string().min(1),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(1).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await requireOwnedItem(id);
  if ('error' in owned) return owned.error;
  const groups = await prisma.modifierGroup.findMany({
    where: { menuItemId: owned.itemId },
    orderBy: { sortOrder: 'asc' },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  return Response.json(groups.map(serializeGroup));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await requireOwnedItem(id);
  if ('error' in owned) return owned.error;
  const data = Create.parse(await req.json());
  const group = await prisma.modifierGroup.create({
    data: {
      menuItemId: owned.itemId,
      name: data.name,
      minSelect: data.minSelect ?? 0,
      maxSelect: data.maxSelect ?? 1,
      required: data.required ?? false,
      sortOrder: data.sortOrder ?? 0,
    },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  return Response.json(serializeGroup(group));
}
