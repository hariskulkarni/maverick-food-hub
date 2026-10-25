import { requireCapabilityApi } from '@/server/api-auth';
import { loadFleetSnapshot } from '@/server/live-fleet';

/**
 * GET /api/platform/riders/live
 *
 * The 4 s poll behind /platform/live. Returns exactly what the page's first
 * paint uses (server/live-fleet.ts): every online rider plus anyone still
 * working an active order, each with
 *   - `at`      the real GPS-fix time of the plotted position,
 *   - `seenAt`  the last time the app was heard from, and `stale` when that is
 *               older than the auto-offline window ("signal lost"),
 *   - `status`  the leg they are on (IDLE / PENDING / ACCEPTED / PICKED_UP),
 *               `orderId`, `activeOrders` and the leg's destination for ETA.
 * Plus `customers`: drop pins for those orders.
 *
 * Gated by the same `ops:read` capability as the page (delegated platform
 * roles that can open the page no longer get a frozen map). Rider phone
 * numbers are not included — the map never shows them; the rider panel loads
 * contact details through its own endpoint.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireCapabilityApi('ops:read');
  if (gate instanceof Response) return gate;

  const snapshot = await loadFleetSnapshot();
  return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}
