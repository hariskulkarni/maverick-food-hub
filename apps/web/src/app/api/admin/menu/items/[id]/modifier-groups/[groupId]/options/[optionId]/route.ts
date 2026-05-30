import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedOption, serializeOption } from '../../../../variants/_helpers';
import { optionalString } from '@/server/zod-helpers';

const Patch = z.object({
  name: optionalString(80),
  priceDelta: z.number().optional(),
  isDefault: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  const { id, groupId, optionId } = await params;
  const owned = await requireOwnedOption(id, groupId, optionId);
  if ('error' in owned) return owned.error;
  const data = Patch.parse(await req.json());
  const option = await prisma.modifierOption.update({
    where: { id: owned.optionId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.priceDelta !== undefined ? { priceDelta: data.priceDelta as any } : {}),
      ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
      ...(data.isAvailable !== undefined ? { isAvailable: data.isAvailable } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  });
  return Response.json(serializeOption(option));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  const { id, groupId, optionId } = await params;
  const owned = await requireOwnedOption(id, groupId, optionId);
  if ('error' in owned) return owned.error;
  await prisma.modifierOption.delete({ where: { id: owned.optionId } });
  return Response.json({ ok: true });
}
