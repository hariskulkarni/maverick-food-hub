/**
 * DELETE /api/platform/qr/[id]   — permanently delete a QR row (super-admin).
 * PATCH                          — toggle a QR's isActive flag.
 *
 * Used by the platform QR page so super-admin can clean up stale codes (e.g.
 * the legacy `saffron-*` rows whose restaurant was renamed without re-minting).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { id } = await params;
  const existing = await prisma.qrCode.findUnique({ where: { id } });
  if (!existing) return Response.json({ ok: true, deleted: 0 }, { headers: NO_STORE });
  await prisma.qrCode.delete({ where: { id } });
  await audit('platform.qr.delete', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'QrCode',
    entityId: id,
    before: { code: existing.code, restaurantId: existing.restaurantId, type: existing.type },
  });
  return Response.json({ ok: true, deleted: 1 }, { headers: NO_STORE });
}

const PatchBody = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { id } = await params;
  const body = PatchBody.parse(await req.json());
  const before = await prisma.qrCode.findUnique({ where: { id }, select: { isActive: true } });
  const qr = await prisma.qrCode.update({ where: { id }, data: { isActive: body.isActive } });
  await audit('platform.qr.toggle', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'QrCode',
    entityId: id,
    before: { isActive: before?.isActive },
    after: { isActive: qr.isActive },
  });
  return Response.json({ qr }, { headers: NO_STORE });
}
