/**
 * Customer address book — list + create.
 *
 * Auth: any signed-in user; the address is scoped to `session.user.id`.
 * The legacy `/api/addresses` endpoints still exist for the old form; this
 * namespace is what the new picker-based UI talks to.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const CreateBody = z.object({
  label: z.string().min(1).max(40),
  line1: z.string().min(2).max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(60),
  state: z.string().max(60).optional().nullable(),
  postalCode: z.string().min(3).max(12),
  country: z.string().min(2).max(2).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  isDefault: z.boolean().optional()
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const list = await prisma.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
  });
  return Response.json(list);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid', issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId: session.user.id, isDefault: true },
        data: { isDefault: false }
      });
    }
    return tx.address.create({
      data: {
        userId: session.user.id,
        label: data.label,
        line1: data.line1,
        line2: data.line2 || null,
        city: data.city,
        state: data.state || null,
        postalCode: data.postalCode,
        country: data.country || 'IN',
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        isDefault: !!data.isDefault
      }
    });
  });

  return Response.json(created);
}
