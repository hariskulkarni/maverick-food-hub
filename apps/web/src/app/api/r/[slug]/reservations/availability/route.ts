/**
 * GET /api/r/[slug]/reservations/availability
 *
 * Public availability check — returns the free tables at the slug's active
 * branch for a given party size + slot. No auth required: anyone browsing the
 * storefront can probe availability before signing in to book. The branch is
 * still resolved safely by slug (we never accept a branchId from the client).
 *
 * Query params:
 *   partySize    (int, required)
 *   reservedAt   (ISO datetime, required)
 *   durationMin  (int, optional — defaults to the restaurant's setting)
 */
import { NextRequest } from 'next/server';
import { findAvailableTables } from '@/server/reservations';
import { resolveBranchForSlug } from '../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const branch = await resolveBranchForSlug(slug);
  if (!branch) return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  if (!branch.dineInEnabled) {
    return Response.json({ error: 'Reservations are not available here', dineInEnabled: false }, { status: 200 });
  }

  const sp = req.nextUrl.searchParams;
  const partySize = Number(sp.get('partySize'));
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    return Response.json({ error: 'partySize must be an integer between 1 and 50' }, { status: 400 });
  }

  const reservedAtRaw = sp.get('reservedAt');
  const reservedAt = reservedAtRaw ? new Date(reservedAtRaw) : null;
  if (!reservedAt || Number.isNaN(reservedAt.getTime())) {
    return Response.json({ error: 'reservedAt must be a valid ISO datetime' }, { status: 400 });
  }
  if (reservedAt.getTime() <= Date.now()) {
    return Response.json({ error: 'reservedAt must be in the future', tables: [] }, { status: 200 });
  }

  const durationRaw = sp.get('durationMin');
  let durationMin = branch.reservationDurationMin;
  if (durationRaw != null && durationRaw !== '') {
    const d = Number(durationRaw);
    if (!Number.isInteger(d) || d < 15 || d > 600) {
      return Response.json({ error: 'durationMin must be an integer between 15 and 600' }, { status: 400 });
    }
    durationMin = d;
  }

  const tables = await findAvailableTables({
    branchId: branch.branchId,
    partySize,
    reservedAt,
    durationMin,
  });

  return Response.json({
    tables,
    durationMin,
    depositAmount: branch.reservationDeposit,
    discountPct: branch.reservationDiscountPct,
  });
}
