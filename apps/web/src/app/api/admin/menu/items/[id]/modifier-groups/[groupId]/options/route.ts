import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOwnedGroup, serializeOption } from '../../../variants/_helpers';

const Create = z.object({
  name: z.string().min(1),
  priceDelta: z.number().optional(),
  isDefault: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const { id, groupId } = await params;
  const owned = await requireOwnedGroup(id, groupId);
  if ('error' in owned) return owned.error;
  const data = Create.parse(await req.json());
  const option = await prisma.modifierOption.create({
    data: {
      modifierGroupId: owned.groupId,
      name: data.name,
      priceDelta: (data.priceDelta ?? 0) as any,
      isDefault: data.isDefault ?? false,
      isAvailable: data.isAvailable ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
  return Response.json(serializeOption(option));
}
