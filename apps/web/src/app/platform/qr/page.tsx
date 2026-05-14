/**
 * Platform · QR codes
 * Lists every QR across the platform with scans and conversion rate.
 * Conversion = orderCount / scanCount.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { QrCode, Activity, MousePointerClick, TrendingUp } from 'lucide-react';

export const metadata = { title: 'Platform · QR codes' };
export const dynamic = 'force-dynamic';

export default async function PlatformQrPage() {
  await requireSuperAdmin();

  const qrs = await prisma.qrCode.findMany({
    orderBy: { createdAt: 'desc' },
    include: { restaurant: { select: { name: true, slug: true } } },
    take: 500
  });

  const totals = qrs.reduce<{ scans: number; orders: number; active: number }>(
    (acc, q: any) => ({ scans: acc.scans + q.scanCount, orders: acc.orders + q.orderCount, active: acc.active + (q.isActive ? 1 : 0) }),
    { scans: 0, orders: 0, active: 0 }
  );
  const cvr = totals.scans > 0 ? (totals.orders / totals.scans) * 100 : 0;

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold flex items-center gap-2"><QrCode className="size-7 text-primary" /> QR codes</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every QR code generated for a restaurant, branch, table, or marketing campaign. Scans and conversion are tracked automatically.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat icon={Activity} label="Active QRs" value={totals.active.toLocaleString()} tone="primary" />
          <Stat icon={MousePointerClick} label="Total scans" value={totals.scans.toLocaleString()} tone="primary" />
          <Stat icon={TrendingUp} label="Conversion" value={`${cvr.toFixed(1)}%`} tone="success" />
        </div>
      </header>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Code</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Restaurant</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Scans</th>
              <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Orders</th>
              <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">CVR</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {qrs.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No QR codes yet.</td></tr>
            )}
            {qrs.map((q: any) => {
              const conv = q.scanCount > 0 ? (q.orderCount / q.scanCount) * 100 : 0;
              return (
                <tr key={q.id}>
                  <td className="px-4 py-3 font-mono text-xs">{q.code}{q.campaignName && <div className="text-[11px] text-muted-foreground">{q.campaignName}</div>}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{q.restaurant.name}</div>
                    <div className="text-[11px] text-muted-foreground">/r/{q.restaurant.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-xs"><Badge variant="muted">{q.type}</Badge></td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{q.scanCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{q.orderCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{conv.toFixed(1)}%</td>
                  <td className="px-4 py-3">{q.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Disabled</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'success' | 'primary' }) {
  const cls = tone === 'success' ? 'bg-success/10 text-success border-success/30' : 'bg-primary/10 text-primary border-primary/30';
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
