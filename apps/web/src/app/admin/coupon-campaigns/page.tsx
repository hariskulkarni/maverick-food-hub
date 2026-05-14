/**
 * Admin · Coupon campaigns — list view.
 *
 * Loads all campaigns for the current restaurant, joins each one's linked Offer
 * and a redemption-count, then hands off to the client component for the
 * filter/search/CTA UX.
 *
 * Lifecycle is derived (active | paused | expired | draft) so the UI doesn't
 * need to query for the current time on the server multiple times.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { CampaignsClient, type CampaignRow } from './campaigns-client';

export const metadata = { title: 'Admin · Coupon campaigns' };
export const dynamic = 'force-dynamic';

export default async function CouponCampaignsPage() {
  const restaurant = await requireRestaurant();

  const rows = await (prisma as any).couponCampaign.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      offers: {
        select: {
          id: true,
          code: true,
          isActive: true,
          usageLimit: true,
          usedCount: true,
          _count: { select: { redemptions: true } }
        }
      }
    }
  });

  const now = Date.now();

  const campaigns: CampaignRow[] = rows.map((c: any) => {
    const offer = c.offers?.[0] ?? null;
    const expired = c.expiresAt && new Date(c.expiresAt).getTime() < now;
    const lifecycle: CampaignRow['lifecycle'] = expired
      ? 'expired'
      : c.status === 'PAUSED'
      ? 'paused'
      : c.status === 'DRAFT'
      ? 'draft'
      : 'active';
    const redeemed = offer?._count?.redemptions ?? 0;
    const conversionRate = redeemed / Math.max(1, c.distributedCount || 0);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      codePrefix: c.codePrefix,
      channel: c.channel,
      discountType: c.discountType,
      discountValue: Number(c.discountValue),
      maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : null,
      minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
      maxUses: c.maxUses ?? null,
      perUserLimit: c.perUserLimit,
      validFrom: c.validFrom?.toISOString?.() ?? String(c.validFrom),
      expiresAt: c.expiresAt ? (c.expiresAt.toISOString?.() ?? String(c.expiresAt)) : null,
      distributedCount: c.distributedCount,
      status: c.status,
      lifecycle,
      offer: offer
        ? {
            id: offer.id,
            code: offer.code,
            isActive: offer.isActive,
            usageLimit: offer.usageLimit,
            usedCount: offer.usedCount,
            redemptions: redeemed
          }
        : null,
      conversionRate
    };
  });

  // KPI strip data — Active count, redemptions this month, total revenue, avg conversion
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const offerIds = campaigns.flatMap((c) => (c.offer ? [c.offer.id] : []));
  let redemptionsThisMonth = 0;
  let revenueThisMonth = 0;
  if (offerIds.length > 0) {
    const rs = await (prisma as any).offerRedemption.findMany({
      where: { offerId: { in: offerIds }, createdAt: { gte: monthStart } },
      include: { order: { select: { total: true } } }
    });
    redemptionsThisMonth = rs.length;
    revenueThisMonth = rs.reduce((acc: number, r: any) => acc + Number(r.order?.total ?? 0), 0);
  }
  const activeCount = campaigns.filter((c) => c.lifecycle === 'active').length;
  const ratesWithData = campaigns.filter((c) => c.distributedCount > 0);
  const avgConversionRate =
    ratesWithData.length > 0
      ? ratesWithData.reduce((acc, c) => acc + c.conversionRate, 0) / ratesWithData.length
      : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Coupon campaigns</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-channel coupons for {restaurant.name}. Print a code on a dine-in receipt and the customer types it at online checkout — or email a QR after an online order so they bring it in next time.
        </p>
      </header>
      <CampaignsClient
        campaigns={campaigns}
        kpis={{
          activeCount,
          redemptionsThisMonth,
          revenueThisMonth,
          avgConversionRate
        }}
      />
    </div>
  );
}
