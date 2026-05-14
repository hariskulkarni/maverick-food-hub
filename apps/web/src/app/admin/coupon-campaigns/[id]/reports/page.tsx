/**
 * Per-campaign report view.
 *
 * Renders KPI tiles (Issued / Distributed / Redeemed / Conversion / Revenue /
 * Discount cost / Net ROI), a channel breakdown stat strip, and the latest
 * 50 redemptions.
 *
 * Date range: server component reads `?range=7d|30d|90d` (default 30d) and
 * computes the window. The preset chips are a client island that re-navigates
 * to update the range.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { money, fmtDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  IndianRupee, Mail, Target, ScrollText, TrendingUp, BarChart3, Smartphone, Utensils
} from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign · Reports' };

type RangePreset = '7d' | '30d' | '90d';

function presetToRange(preset: RangePreset): { from: Date; to: Date } {
  const to = new Date();
  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export default async function ReportsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const sp = await searchParams;

  const presetRaw = sp.range === '7d' || sp.range === '90d' ? sp.range : '30d';
  const preset: RangePreset = presetRaw;
  const { from, to } = presetToRange(preset);

  const campaign = await (prisma as any).couponCampaign.findFirst({
    where: { id, restaurantId: restaurant.id },
    include: { offers: { select: { id: true, code: true, usageLimit: true } } }
  });
  if (!campaign) return notFound();

  const offerIds: string[] = (campaign.offers ?? []).map((o: any) => o.id);

  // Pull redemptions in range with the joined order + customer info we need
  const redemptions = offerIds.length
    ? await (prisma as any).offerRedemption.findMany({
        where: { offerId: { in: offerIds }, createdAt: { gte: from, lte: to } },
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
      })
    : [];

  // Aggregate
  let redeemed = 0;
  let totalDiscount = 0;
  let revenue = 0;
  let onlineCount = 0;
  let dineInCount = 0;
  for (const r of redemptions) {
    redeemed += 1;
    totalDiscount += Number(r.amountOff ?? 0);
    revenue += Number(r.order?.total ?? 0);
    if (r.channel === 'DINE_IN') dineInCount += 1;
    else onlineCount += 1;
  }
  const conversionRate = redeemed / Math.max(1, campaign.distributedCount || 0);
  const netRoi = revenue - totalDiscount;
  const totalChannels = Math.max(1, onlineCount + dineInCount);
  const onlinePct = (onlineCount / totalChannels) * 100;
  const dineInPct = (dineInCount / totalChannels) * 100;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/admin/coupon-campaigns"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← All campaigns
          </Link>
          <h1 className="display text-3xl font-semibold mt-1">{campaign.name}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">
              {campaign.channel === 'DINE_IN_TO_ONLINE' ? '🍽️ → 📱 Dine-in → Online' : '📱 → 🍽️ Online → Dine-in'}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {campaign.offers?.[0]?.code ?? campaign.codePrefix}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <Link
              key={p}
              href={`/admin/coupon-campaigns/${id}/reports?range=${p}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                p === preset
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-accent text-muted-foreground'
              }`}
            >
              {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
            </Link>
          ))}
        </div>
      </header>

      <div className="text-xs text-muted-foreground">
        Showing {fmtDate(from, { dateStyle: 'medium' })} — {fmtDate(to, { dateStyle: 'medium' })}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi
          icon={ScrollText}
          label="Issued"
          value={campaign.maxUses ? String(campaign.maxUses) : '∞'}
          hint="Cap on total redemptions"
        />
        <Kpi
          icon={Mail}
          label="Distributed"
          value={(campaign.distributedCount ?? 0).toLocaleString('en-IN')}
          hint="Receipts / emails sent"
        />
        <Kpi
          icon={TrendingUp}
          label="Redeemed"
          value={String(redeemed)}
          hint={`In selected range`}
        />
        <Kpi
          icon={Target}
          label="Conversion"
          value={campaign.distributedCount > 0 ? `${(conversionRate * 100).toFixed(1)}%` : '—'}
          hint="Redeemed / distributed"
        />
        <Kpi
          icon={IndianRupee}
          label="Revenue"
          value={money(revenue)}
          hint="Order totals (incl. tax)"
        />
        <Kpi
          icon={BarChart3}
          label="Discount cost"
          value={money(totalDiscount)}
          hint="Total amount discounted"
        />
        <Kpi
          icon={IndianRupee}
          label="Net ROI"
          value={money(netRoi)}
          hint={netRoi >= 0 ? 'Revenue − discount' : 'Net loss'}
          tone={netRoi >= 0 ? 'success' : 'destructive'}
        />
      </div>

      {/* Channel breakdown strip */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Channel breakdown
          </div>
          {redeemed === 0 ? (
            <div className="text-sm text-muted-foreground">
              No redemptions in this range yet.
            </div>
          ) : (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-primary"
                  style={{ width: `${onlinePct}%` }}
                  title={`${onlineCount} online`}
                />
                <div
                  className="bg-warning"
                  style={{ width: `${dineInPct}%` }}
                  title={`${dineInCount} dine-in`}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full bg-primary" />
                  <Smartphone className="size-4 text-muted-foreground" />
                  <span className="font-medium">Online</span>
                  <span className="tabular-nums text-muted-foreground ml-auto">
                    {onlineCount} ({onlinePct.toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full bg-warning" />
                  <Utensils className="size-4 text-muted-foreground" />
                  <span className="font-medium">Dine-in</span>
                  <span className="tabular-nums text-muted-foreground ml-auto">
                    {dineInCount} ({dineInPct.toFixed(0)}%)
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent redemptions table */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-4 flex items-center justify-between">
            <div className="text-sm font-semibold">Recent redemptions</div>
            <div className="text-xs text-muted-foreground">Latest 50</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>When</Th>
                  <Th>Customer</Th>
                  <Th>Order</Th>
                  <Th>Channel</Th>
                  <Th align="right">Order total</Th>
                  <Th align="right">Amount off</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {redemptions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-muted-foreground">
                      No redemptions in the selected range yet.
                    </td>
                  </tr>
                )}
                {redemptions.slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(r.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono">
                      {maskPhone(r.order?.customer?.phone ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="font-mono">{r.order?.code ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={r.channel === 'DINE_IN' ? 'warning' : 'secondary'} className="text-[10px]">
                        {r.channel === 'DINE_IN' ? 'Dine-in' : 'Online'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {money(Number(r.order?.total ?? 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-primary">
                      −{money(Number(r.amountOff ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" asChild>
          <Link href={`/admin/coupon-campaigns/${id}/qr-poster`} target="_blank">
            View QR poster
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, hint, tone
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'destructive';
}) {
  const toneCls =
    tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold leading-tight tabular-nums truncate ${toneCls}`}>
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`${a} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>
      {children}
    </th>
  );
}

// Mask everything except the last 4 digits — "91*****1234"
function maskPhone(p: string | null): string {
  if (!p) return '—';
  const digits = p.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  const tail = digits.slice(-4);
  const head = digits.slice(0, Math.min(2, digits.length - 4));
  return `${head}${'*'.repeat(digits.length - head.length - 4)}${tail}`;
}
