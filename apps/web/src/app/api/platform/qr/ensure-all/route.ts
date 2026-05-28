/**
 * POST /api/platform/qr/ensure-all — mint a RESTAURANT-scope QR for every
 * active restaurant that doesn't already have one. Idempotent. Super-admin only.
 *
 * This is the "Generate missing" sweep behind the platform QR page so a fresh
 * deploy (or new restaurants added since the last sweep) lights up the entire
 * list with one click — no per-restaurant minting needed.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { ensureRestaurantQr } from '@/server/qr';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST() {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  // Every active restaurant — including ones that already have a QR (the
  // ensure helper is a no-op for those, so this stays idempotent).
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let created = 0;
  let skipped = 0;
  for (const r of restaurants) {
    const { created: didCreate } = await ensureRestaurantQr(r.id);
    if (didCreate) created++;
    else skipped++;
  }

  if (created > 0) {
    await audit('platform.qr.ensure_all', {
      actorId: session.user.id,
      actorRole: session.user.role,
      entityType: 'QrCode',
      after: { created, skipped, total: restaurants.length },
    });
  }

  return Response.json({ created, skipped, total: restaurants.length }, { headers: NO_STORE });
}
