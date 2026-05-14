/**
 * Print-friendly A4 poster for a coupon campaign.
 *
 * Loads the campaign + its linked Offer, renders a clean centered layout with
 * a QR code, the discount headline, the coupon code in large monospace, and
 * the validity dates as small print.
 *
 * The redemption URL is built from the offer code:
 *   - ONLINE_TO_DINE_IN: customer scans the QR in-restaurant. We deep-link to
 *     the restaurant's own page so they can confirm where to apply it.
 *   - DINE_IN_TO_ONLINE: customer is going to use it online. Same restaurant
 *     deep-link — the customer lands on the menu with the code pre-applied.
 *
 * Print styling: a `print:` strip-down class removes screen chrome so File →
 * Print yields a clean poster.
 */
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { money, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PrintButtonClient } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign · QR poster' };

const PUBLIC_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://maverick.app';

export default async function QrPosterPage({ params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const campaign = await (prisma as any).couponCampaign.findFirst({
    where: { id, restaurantId: restaurant.id },
    include: { offers: true }
  });
  if (!campaign) return notFound();

  const offer = campaign.offers?.[0];
  const code = offer?.code ?? campaign.codePrefix;
  const isDineToOnline = campaign.channel === 'DINE_IN_TO_ONLINE';

  // Build the redemption URL. Both flows deep-link to the restaurant's own page
  // with the code pre-applied via querystring.
  const redemptionUrl = `${PUBLIC_BASE}/r/${restaurant.slug}?code=${encodeURIComponent(code)}`;

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(redemptionUrl)}&size=400x400&margin=2`;

  const discountHeadline = (() => {
    const v = Number(campaign.discountValue);
    if (campaign.discountType === 'PERCENTAGE') {
      const cap = campaign.maxDiscount ? ` (max ${money(Number(campaign.maxDiscount))})` : '';
      return `Get ${v}% off${cap} your next order`;
    }
    return `Get ${money(v)} off your next order`;
  })();

  const subheading = isDineToOnline
    ? 'Order online at the link below — enter the code at checkout'
    : 'Scan this QR when you next visit — show it at the counter';

  return (
    <div className="min-h-dvh bg-background">
      {/* Screen-only toolbar */}
      <div className="print:hidden border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/coupon-campaigns`}>← Back</Link>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <PrintButtonClient />
          </div>
        </div>
      </div>

      {/* A4 poster — 210 × 297mm. Centered, print:scale-100 */}
      <div className="mx-auto print:m-0 print:max-w-none max-w-[210mm] bg-white text-black border print:border-0 mt-6 print:mt-0 shadow-sm print:shadow-none"
           style={{ width: '210mm', minHeight: '297mm' }}>
        <div className="h-full flex flex-col items-center justify-between p-12 text-center">
          {/* Top: brand + campaign name */}
          <div className="w-full">
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">{restaurant.name}</div>
            <h1 className="mt-3 text-4xl font-bold leading-tight">{campaign.name}</h1>
            <p className="mt-3 text-xl font-medium text-zinc-800">{discountHeadline}</p>
          </div>

          {/* Middle: QR + code */}
          <div className="flex flex-col items-center my-8">
            <img
              src={qrSrc}
              alt={`QR code for ${code}`}
              width={400}
              height={400}
              className="border border-zinc-200"
            />
            <div className="mt-2 text-[11px] text-zinc-500 break-all max-w-md">{redemptionUrl}</div>
            <div className="mt-6 text-sm uppercase tracking-widest text-zinc-500">Coupon code</div>
            <div className="mt-1 font-mono font-bold text-5xl tracking-widest px-6 py-3 border-2 border-dashed border-zinc-700 rounded-md">
              {code}
            </div>
          </div>

          {/* Bottom: how-to + small print */}
          <div className="w-full">
            <p className="text-base text-zinc-700">{subheading}</p>
            <div className="mt-6 text-[11px] text-zinc-500 leading-relaxed space-y-0.5">
              {campaign.minOrderAmount && (
                <div>Minimum order {money(Number(campaign.minOrderAmount))}.</div>
              )}
              {campaign.perUserLimit > 0 && (
                <div>Limit {campaign.perUserLimit} use{campaign.perUserLimit === 1 ? '' : 's'} per customer.</div>
              )}
              <div>
                Valid {fmtDate(campaign.validFrom, { dateStyle: 'medium' })}
                {campaign.expiresAt ? <> through {fmtDate(campaign.expiresAt, { dateStyle: 'medium' })}</> : ' onwards'}.
              </div>
              <div className="mt-1">Terms & conditions apply. Cannot be combined with other offers.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

