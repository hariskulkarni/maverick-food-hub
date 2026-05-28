/**
 * Platform · QR codes — restaurant-first dashboard.
 *
 * Lists EVERY active restaurant on the platform (not just ones that happen to
 * already have a QR row). Each restaurant card shows:
 *   • its QR codes (RESTAURANT / BRANCH / TABLE / CAMPAIGN) with scans + CVR,
 *   • a "Generate restaurant QR" action when none exists yet,
 *   • per-branch "Branch QR" mint buttons,
 *   • per-row enable/disable + delete (for cleaning legacy entries).
 *
 * The top "Generate missing" sweep mints a RESTAURANT QR for every restaurant
 * that lacks one in a single click. Conversion = orderCount / scanCount.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QrCode, Activity, MousePointerClick, TrendingUp, Download, AlertTriangle, Building2 } from 'lucide-react';
import { qrPngDataUrl, qrScanUrl } from '@/server/qr-image';
import { BulkEnsureButton, EnsureRestaurantButton, MintBranchQrButton, QrRowActions } from './qr-actions';

export const metadata = { title: 'Platform · QR codes' };
export const dynamic = 'force-dynamic';

export default async function PlatformQrPage() {
  await requireSuperAdmin();

  // Every active restaurant with all of its QRs + branches. We deliberately
  // include even those with zero QRs so the page surfaces the gap.
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ name: 'asc' }],
    include: {
      branches: { where: { isActive: true }, select: { id: true, name: true, slug: true, city: true } },
      qrCodes: { orderBy: [{ createdAt: 'desc' }] },
    },
  });

  // Pre-render scannable QR PNGs server-side so the client gets ready data URLs.
  const groups = await Promise.all(
    restaurants.map(async (r) => {
      const qrs = await Promise.all(
        r.qrCodes.map(async (q) => {
          const url = qrScanUrl(q.code);
          return { ...q, url, qrPng: await qrPngDataUrl(url, 160) };
        }),
      );
      const scans = qrs.reduce((s, q) => s + q.scanCount, 0);
      const orders = qrs.reduce((s, q) => s + q.orderCount, 0);
      const hasRestaurantQr = qrs.some((q) => q.type === 'RESTAURANT' && q.isActive);
      // Map branch -> first active branch QR (so we don't double-mint).
      const branchQrIds = new Set(qrs.filter((q) => q.type === 'BRANCH' && q.branchId).map((q) => q.branchId!));
      return { restaurant: r, qrs, scans, orders, hasRestaurantQr, branchQrIds };
    }),
  );

  const totals = groups.reduce(
    (a, g) => ({
      scans: a.scans + g.scans,
      orders: a.orders + g.orders,
      active: a.active + g.qrs.filter((q) => q.isActive).length,
      missing: a.missing + (g.hasRestaurantQr ? 0 : 1),
    }),
    { scans: 0, orders: 0, active: 0, missing: 0 },
  );
  const cvr = totals.scans > 0 ? (totals.orders / totals.scans) * 100 : 0;

  // Sort: restaurants missing a RESTAURANT QR first (so the gap is obvious), then by name.
  groups.sort((a, b) => {
    if (a.hasRestaurantQr !== b.hasRestaurantQr) return a.hasRestaurantQr ? 1 : -1;
    return a.restaurant.name.localeCompare(b.restaurant.name);
  });

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold flex items-center gap-2">
            <QrCode className="size-7 text-primary" /> QR codes
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every restaurant on the platform with the QR codes it has minted.
            <span className="block mt-1">
              <strong>Scans</strong> counts how many times a customer scanned the code; <strong>orders</strong> is
              the orders placed in sessions that originated from that scan; <strong>CVR</strong> = orders ÷ scans.
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Stat icon={Building2} label="Restaurants" value={groups.length.toLocaleString()} tone="primary" />
          <Stat icon={Activity} label="Active QRs" value={totals.active.toLocaleString()} tone="primary" />
          <Stat icon={MousePointerClick} label="Total scans" value={totals.scans.toLocaleString()} tone="primary" />
          <Stat icon={TrendingUp} label="Conversion" value={`${cvr.toFixed(1)}%`} tone="success" />
          {totals.missing > 0 && (
            <Stat icon={AlertTriangle} label="Missing QR" value={totals.missing.toLocaleString()} tone="warning" />
          )}
          <BulkEnsureButton />
        </div>
      </header>

      {groups.length === 0 && (
        <Card><CardContent className="p-10 text-center text-muted-foreground">No active restaurants yet.</CardContent></Card>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.restaurant.id}>
            <CardContent className="p-5 space-y-4">
              {/* Restaurant header row */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-base">{g.restaurant.name}</div>
                    {!g.hasRestaurantQr && (
                      <Badge variant="muted" className="border-warning/40 bg-warning/10 text-warning">No restaurant QR</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">/r/{g.restaurant.slug} · {g.restaurant.branches.length} branch{g.restaurant.branches.length === 1 ? '' : 'es'}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!g.hasRestaurantQr && (
                    <EnsureRestaurantButton restaurantId={g.restaurant.id} />
                  )}
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{g.scans.toLocaleString()}</span> scans · <span className="font-mono">{g.orders.toLocaleString()}</span> orders
                  </div>
                </div>
              </div>

              {/* QR rows */}
              {g.qrs.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
                  No QR codes for this restaurant yet — click <strong>Generate restaurant QR</strong> above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">QR</th>
                        <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Code</th>
                        <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Type</th>
                        <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Branch / Campaign</th>
                        <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Scans</th>
                        <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Orders</th>
                        <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">CVR</th>
                        <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
                        <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {g.qrs.map((q) => {
                        const conv = q.scanCount > 0 ? (q.orderCount / q.scanCount) * 100 : 0;
                        const branch = q.branchId ? g.restaurant.branches.find((b) => b.id === q.branchId) : null;
                        return (
                          <tr key={q.id}>
                            <td className="px-3 py-2 align-top">
                              <div className="space-y-1">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={q.qrPng} alt={`QR code for ${q.url}`} width={64} height={64} className="rounded border bg-white p-1" />
                                <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                                  <a href={q.qrPng} download={`qr-${q.code}.png`}>
                                    <Download className="size-3" /> PNG
                                  </a>
                                </Button>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs align-top">{q.code}</td>
                            <td className="px-3 py-2 align-top"><Badge variant="muted">{q.type}</Badge></td>
                            <td className="px-3 py-2 text-xs align-top">
                              {branch ? <span>{branch.name}{branch.city ? <span className="text-muted-foreground"> · {branch.city}</span> : null}</span> : null}
                              {q.campaignName ? <span className="block text-muted-foreground">{q.campaignName}</span> : null}
                              {!branch && !q.campaignName ? <span className="text-muted-foreground">—</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs align-top">{q.scanCount.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs align-top">{q.orderCount.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs align-top">{conv.toFixed(1)}%</td>
                            <td className="px-3 py-2 align-top">{q.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Disabled</Badge>}</td>
                            <td className="px-3 py-2 text-right align-top"><QrRowActions qrId={q.id} isActive={q.isActive} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Branch-level mint shortcuts */}
              {g.restaurant.branches.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
                  <span>Mint a branch QR:</span>
                  {g.restaurant.branches.map((b) => (
                    <MintBranchQrButton key={b.id} restaurantId={g.restaurant.id} branchId={b.id} branchName={b.name} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'success' | 'primary' | 'warning' }) {
  const cls =
    tone === 'success'
      ? 'bg-success/10 text-success border-success/30'
      : tone === 'warning'
      ? 'bg-warning/10 text-warning border-warning/40'
      : 'bg-primary/10 text-primary border-primary/30';
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${cls}`}>
      <Icon className="size-5" />
      <div>
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div className="font-bold text-base leading-none">{value}</div>
      </div>
    </div>
  );
}
