/**
 * GET /api/qr/[code]/resolve
 * Resolves a QR code to a storefront redirect target. Increments scanCount.
 * Returns 404 if the QR is missing or inactive.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const rl = await rateLimit(_req, { name: 'qr-resolve', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const { code } = await params;
  if (!code) return new Response('Not found', { status: 404 });

  // Increment scanCount in the same query. If the QR is missing the update
  // throws P2025, which we map to 404. We then re-check isActive.
  let qr;
  try {
    qr = await prisma.qrCode.update({
      where: { code },
      data: { scanCount: { increment: 1 } },
      include: { restaurant: { select: { slug: true, status: true } } }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!qr.isActive || qr.restaurant.status !== 'ACTIVE') {
    return new Response('Not found', { status: 404 });
  }

  const redirectTo = `/r/${qr.restaurant.slug}?qr=${encodeURIComponent(qr.code)}`;
  return Response.json({
    restaurantSlug: qr.restaurant.slug,
    branchId: qr.branchId ?? undefined,
    tableId: qr.tableId ?? undefined,
    redirectTo
  });
}
