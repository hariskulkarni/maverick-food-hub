/** POST /api/admin/onboarding/qr — make sure the restaurant has its storefront QR; returns its scan path. */
import { NextRequest } from 'next/server';
import { audit } from '@/server/audit';
import { onboardingAdminScope, auditMeta } from '@/server/onboarding-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  const { ensureRestaurantQr } = await import('@/server/qr');
  const { qr, created } = await ensureRestaurantQr(scope.restaurant.id);
  if (created) {
    await audit('qr.create', {
      actorId: scope.session.user.id,
      actorRole: scope.session.user.role,
      restaurantId: scope.restaurant.id,
      entityType: 'QrCode',
      entityId: qr.id,
      after: { code: qr.code, type: qr.type, via: 'onboarding' },
      ...auditMeta(req),
    });
  }
  return Response.json({ code: qr.code, path: `/qr/${qr.code}`, created, scanCount: qr.scanCount });
}
