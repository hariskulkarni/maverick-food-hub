/**
 * GET /api/platform/settlements?restaurantId=&from=&to=
 * Returns the full computed settlement report (summary, payout breakup, order
 * lines, discounts summary, tax) for a restaurant + date window. Super-admin.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { buildSettlementReport } from '@/server/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseRange(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const restaurantId = sp.get('restaurantId') ?? '';
  const now = new Date();
  const toStr = sp.get('to');
  const fromStr = sp.get('from');
  const to = toStr ? new Date(toStr + 'T23:59:59') : now;
  const from = fromStr ? new Date(fromStr + 'T00:00:00') : new Date(to.getTime() - 6 * 86400000);
  return { restaurantId, from, to };
}

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { restaurantId, from, to } = parseRange(req);
  if (!restaurantId) return Response.json({ ok: false, message: 'restaurantId required' }, { status: 400 });
  try {
    const report = await buildSettlementReport(restaurantId, from, to);
    return Response.json({ ok: true, report });
  } catch (e) {
    return Response.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
