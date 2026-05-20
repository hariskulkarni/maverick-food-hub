import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedGroup, serializeGroup } from '../../variants/_helpers';

const Patch = z.object({
  name: z.string().min(1).optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(1).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const { id, groupId } = await params;
  const owned = await requireOwnedGroup(id, groupId);
  if ('error' in owned) return owned.error;
  const data = Patch.parse(await req.json());
  const group = await prisma.modifierGroup.update({
    where: { id: owned.groupId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.minSelect !== undefined ? { minSelect: data.minSelect } : {}),
      ...(data.maxSelect !== undefined ? { maxSelect: data.maxSelect } : {}),
      ...(data.required !== undefined ? { required: data.required } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  return Response.json(serializeGroup(group));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const { id, groupId } = await params;
  const owned = await requireOwnedGroup(id, groupId);
  if ('error' in owned) return owned.error;
  await prisma.modifierGroup.delete({ where: { id: owned.groupId } });
  return Response.json({ ok: true });
}
