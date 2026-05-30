/**
 * Campaign report endpoint.
 *
 *   GET /api/admin/coupon-campaigns/[id]/reports?from=&to=
 *
 * Returns the headline KPIs for the date range (defaults: last 30 days):
 *   {
 *     issued: <usageLimit if set, else "unlimited">,
 *     distributed: campaign.distributedCount,
 *     redeemed: <count from OfferRedemption>,
 *     conversionRate: redeemed / max(1, distributed),
 *     revenue: <SUM(order.total)>,
 *     totalDiscount: <SUM(OfferRedemption.amountOff)>,
 *     channelBreakdown: { online: N, dineIn: N }
 *   }
 *
 * The denominator for conversionRate is `distributedCount` (admin-maintained
 * count of receipts/emails sent), not `usageLimit` — the funnel is "we sent X,
 * Y redeemed" not "we offered X seats, Y filled".
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await requireRestaurant();
  const { id } = await params;

  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return Response.json({ error: 'Invalid date range', reason: 'invalid_range' }, { status: 400 });
  }
  if (from >= to) {
    return Response.json({ error: '`from` must be before `to`', reason: 'invalid_range_order' }, { status: 400 });
  }

  const campaign = await (prisma as any).couponCampaign.findFirst({
    where: { id, restaurantId: r.id },
    include: { offers: { select: { id: true, usageLimit: true } } }
  });
  if (!campaign) return Response.json({ error: 'Campaign not found', reason: 'not_found' }, { status: 404 });

  const offerIds: string[] = (campaign.offers ?? []).map((o: any) => o.id);
  const usageLimit: number | null = campaign.maxUses ?? null;

  // Aggregate over OfferRedemption rows in the range
  let redeemed = 0;
  let totalDiscount = 0;
  let revenue = 0;
  let onlineCount = 0;
  let dineInCount = 0;
  let recent: Array<{
    id: string;
    amountOff: number;
    channel: string;
    createdAt: string;
    order: { id: string; code: string; total: number } | null;
    customerPhone: string | null;
  }> = [];

  if (offerIds.length > 0) {
    const redemptions = await (prisma as any).offerRedemption.findMany({
      where: {
        offerId: { in: offerIds },
        createdAt: { gte: from, lte: to }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            code: true,
            total: true,
            customer: { select: { phone: true } }
          }
        }
      }
    });

    redeemed = redemptions.length;
    for (const r of redemptions) {
      totalDiscount += Number(r.amountOff ?? 0);
      revenue += Number(r.order?.total ?? 0);
      if (r.channel === 'DINE_IN') dineInCount += 1;
      else onlineCount += 1;
    }

    recent = redemptions.slice(0, 50).map((r: any) => ({
      id: r.id,
      amountOff: Number(r.amountOff ?? 0),
      channel: r.channel,
      createdAt: r.createdAt.toISOString(),
      order: r.order ? { id: r.order.id, code: r.order.code, total: Number(r.order.total) } : null,
      customerPhone: r.order?.customer?.phone ?? null
    }));
  }

  const conversionRate = redeemed / Math.max(1, campaign.distributedCount || 0);

  return Response.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    issued: usageLimit ?? 'unlimited',
    distributed: campaign.distributedCount ?? 0,
    redeemed,
    conversionRate,
    revenue,
    totalDiscount,
    netRoi: revenue - totalDiscount,
    channelBreakdown: { online: onlineCount, dineIn: dineInCount },
    recent
  });
}
