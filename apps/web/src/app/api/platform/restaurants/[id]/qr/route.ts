/**
 * GET /api/platform/restaurants/[id]/qr   — list every QR for a restaurant
 * POST                                     — create a new QR
 *
 * The `code` is an 8-char nanoid slug; we collision-retry up to 5 times
 * which is cosmically unlikely at this length but cheap to defend against.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { QrType } from '@prisma/client';

const nano = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const qrs = await prisma.qrCode.findMany({
    where: { restaurantId: id },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json({ qrs });
}

const PostBody = z.object({
  type: z.nativeEnum(QrType),
  branchId: z.string().optional(),
  tableId: z.string().optional(),
  campaignName: z.string().max(80).optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const body = PostBody.parse(await req.json());

  // Verify the restaurant exists before we mint a code.
  const restaurant = await prisma.restaurant.findUnique({ where: { id }, select: { id: true } });
  if (!restaurant) return new Response('Restaurant not found', { status: 404 });

  let qr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nano();
    try {
      qr = await prisma.qrCode.create({
        data: {
          code,
          restaurantId: id,
          type: body.type,
          branchId: body.branchId,
          tableId: body.tableId,
          campaignName: body.campaignName
        }
      });
      break;
    } catch {
      // unique-constraint collision — retry
    }
  }
  if (!qr) return new Response('Failed to generate code', { status: 500 });
  return Response.json({ qr });
}
