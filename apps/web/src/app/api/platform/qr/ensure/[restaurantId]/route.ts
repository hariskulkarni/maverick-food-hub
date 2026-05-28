/**
 * POST /api/platform/qr/ensure/[restaurantId]
 * Idempotent — ensures THIS restaurant has at least one RESTAURANT-scope QR.
 * Used by the per-row "Generate" button on /platform/qr. Super-admin only.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { ensureRestaurantQr } from '@/server/qr';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { restaurantId } = await params;
  const { qr, created } = await ensureRestaurantQr(restaurantId);
  if (created) {
    await audit('platform.qr.ensure', {
      actorId: session.user.id,
      actorRole: session.user.role,
      entityType: 'QrCode',
      entityId: qr.id,
      after: { code: qr.code, restaurantId },
    });
  }
  return Response.json({ qr, created }, { headers: { 'Cache-Control': 'no-store' } });
}
