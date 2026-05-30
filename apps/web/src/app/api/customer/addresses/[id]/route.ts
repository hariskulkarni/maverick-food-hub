/**
 * Customer address — update / delete a single record.
 *
 * Delete refuses if the row is the user's only address AND it is the default;
 * removing a default they cannot replace would leave checkout in a weird
 * state. Edit defaults via /[id]/default instead.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { optionalString, parseOrJsonError } from '@/server/zod-helpers';

const PatchBody = z.object({
  label: optionalString(40),
  line1: optionalString(200),
  line2: z.string().max(200).optional().nullable(),
  city: optionalString(60),
  state: z.string().max(60).optional().nullable(),
  postalCode: optionalString(12),
  country: optionalString(2),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  isDefault: z.boolean().optional()
});

async function ownedAddress(id: string, userId: string) {
  const a = await prisma.address.findUnique({ where: { id } });
  if (!a || a.userId !== userId) return null;
  return a;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const existing = await ownedAddress(id, session.user.id);
  if (!existing) return new Response('Not found', { status: 404 });

  const parsed = parseOrJsonError(PatchBody, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId: session.user.id, isDefault: true, NOT: { id } },
        data: { isDefault: false }
      });
    }
    return tx.address.update({ where: { id }, data });
  });
  return Response.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const existing = await ownedAddress(id, session.user.id);
  if (!existing) return new Response('Not found', { status: 404 });

  const count = await prisma.address.count({ where: { userId: session.user.id } });
  if (existing.isDefault && count <= 1) {
    return Response.json(
      { error: 'cannot_delete_only_default', message: 'Add another address before deleting your default.' },
      { status: 409 }
    );
  }

  await prisma.address.delete({ where: { id } });

  // If we removed the default and another address exists, promote the most recent one.
  if (existing.isDefault) {
    const next = await prisma.address.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' }
    });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }

  return Response.json({ ok: true });
}
