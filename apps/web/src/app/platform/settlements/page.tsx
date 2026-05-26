import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { buildSettlementReport, type SettlementReport } from '@/server/settlement';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { SettlementControls } from './controls';
import { Wallet, Receipt, MinusCircle, Banknote } from 'lucide-react';

export const metadata = { title: 'Platform · Settlements' };
export const dynamic = 'force-dynamic';

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const restaurants = await prisma.restaurant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

  const today = new Date();
  const defFrom = new Date(today.getTime() - 6 * 86400000);
  const restaurantId = sp.restaurantId || restaurants[0]?.id || '';
  const from = sp.from || ymd(defFrom);
  const to = sp.to || ymd(today);

  let report: SettlementReport | null = null;
  let error: string | null = null;
  if (restaurantId) {
    try {
      report = await buildSettlementReport(restaurantId, new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59'));
    } catch (e) { error = (e as Error).message; }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Settlements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Partner settlement &amp; payout reconciliation — net order value → commission &amp; fees → GST/TCS/TDS → net payout. Export the file partners expect.
        </p>
      </header>

      <Card><CardContent className="p-4">
        <SettlementControls restaurants={restaurants} restaurantId={restaurantId} from={from} to={to} />
      </CardContent></Card>

      {!restaurantId && <Empty msg="Add a restaurant to generate settlements." />}
      {error && <Empty msg={`Could not build report: ${error}`} />}

      {report && (
        <>
          {/* Identity strip */}
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
            <span><strong className="text-foreground">{report.restaurant.name}</strong></span>
            {report.restaurant.gstin && <span>GSTIN: {report.restaurant.gstin}</span>}
            {report.restaurant.pan && <span>PAN: {report.restaurant.pan}</span>}
            <span>Commission: {report.restaurant.commissionPct}%</span>
            <span>Cycle: {report.restaurant.settlementCycle}</span>
            <span>Period: {report.period.from} → {report.period.to}</span>
          </div>

          {/* KPI cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Kpi icon={Receipt} label="Net order value (A)" value={money(report.summary.netOrderValue)} tone="primary"
                 sub={`${report.summary.deliveredOrders} delivered · ${report.summary.cancelledOrders} cancelled`} />
            <Kpi icon={MinusCircle} label="Net deductions (C)" value={money(report.summary.netDeductions)} tone="warning" />
            <Kpi icon={Wallet} label="Net additions (D)" value={money(report.summary.netAdditions)} tone="success" />
            <Kpi icon={Banknote} label="Net payout (E)" value={money(report.summary.netPayout)} tone="primary" big />
          </div>

          {/* Payout Breakup */}
          <Section title="Payout Breakup">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b"><tr>
                <Th>S.no</Th><Th>Particular</Th><Th align="right">Delivered</Th><Th align="right">Cancelled</Th><Th align="right">Total</Th>
              </tr></thead>
              <tbody className="divide-y">
                {report.payoutBreakup.map((b) => {
                  const bold = ['A', 'B', 'C', 'D', 'E'].includes(b.sno);
                  return (
                    <tr key={b.sno + b.particular} className={bold ? 'bg-muted/30 font-semibold' : ''}>
                      <td className="px-3 py-2 text-muted-foreground">{b.sno}</td>
                      <td className="px-3 py-2">{b.particular}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.delivered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.cancelled)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          {/* Order Level */}
          <Section title={`Order Level (${report.lines.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-muted/40 border-b"><tr>
                  {['Order ID','Date','Status','Pay','Construct','Subtotal','Pack','Delivery','Promo','Bonus','GST','Net (A)','Comm.','Pay fee','GST/fee','TCS','TDS','Deduct (C)','Payout (E)']
                    .map((h, i) => <Th key={h} align={i >= 5 ? 'right' : 'left'}>{h}</Th>)}
                </tr></thead>
                <tbody className="divide-y">
                  {report.lines.map((l) => (
                    <tr key={l.orderId} className="hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-mono">{l.code}</td>
                      <td className="px-2 py-1.5">{l.date}</td>
                      <td className="px-2 py-1.5">{l.delivered ? l.status : <span className="text-destructive">{l.status}</span>}</td>
                      <td className="px-2 py-1.5">{l.paymentMethod}</td>
                      <td className="px-2 py-1.5">{l.discountConstruct}</td>
                      {[l.subtotal,l.packaging,l.delivery,l.discountPromo,l.discountBonus,l.gstCollected,l.netOrderValue,l.commission,l.paymentFee,l.gstOnFee,l.tcs,l.tds,l.netDeductions,l.payout]
                        .map((v, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{money(v)}</td>)}
                    </tr>
                  ))}
                  {report.lines.length === 0 && <tr><td colSpan={19} className="p-8 text-center text-muted-foreground">No orders in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Discounts Summary */}
            <Section title="Discounts Summary">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b"><tr>
                  <Th>Construct</Th><Th align="right">Orders</Th><Th align="right">Subtotal</Th><Th align="right">Discount</Th><Th align="right">Eff. %</Th>
                </tr></thead>
                <tbody className="divide-y">
                  {report.discountsSummary.map((d) => (
                    <tr key={d.construct}>
                      <td className="px-3 py-2">{d.construct}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(d.subtotal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(d.discountGiven)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.effectivePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {report.discountsSummary.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No discounts in period.</td></tr>}
                </tbody>
              </table>
            </Section>

            {/* Tax */}
            <Section title="Tax &amp; Compliance">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b"><tr>
                  <Th>Component</Th><Th>Rate</Th><Th align="right">Total</Th>
                </tr></thead>
                <tbody className="divide-y">
                  {report.tax.map((t) => (
                    <tr key={t.component}>
                      <td className="px-3 py-2">{t.component}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.rate}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>

          <p className="text-[11px] text-muted-foreground">
            GST/TCS/TDS rates are configurable defaults (GST-on-fee {18}%, TCS {1}%, TDS 194O {1}%); validate tax treatment with your finance team / CA. Flavrly is not a tax advisor.
          </p>
        </>
      )}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <Card><CardContent className="p-10 text-center text-muted-foreground text-sm">{msg}</CardContent></Card>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</h3>
      <Card><CardContent className="p-0 overflow-hidden">{children}</CardContent></Card>
    </div>
  );
}
function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}
function Kpi({ icon: Icon, label, value, sub, tone, big }: { icon: any; label: string; value: string; sub?: string; tone: 'primary' | 'success' | 'warning'; big?: boolean }) {
  const cls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning' }[tone];
  return (
    <Card><CardContent className="p-4">
      <div className={`inline-flex size-9 items-center justify-center rounded-lg ${cls}`}><Icon className="size-5" /></div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-2">{label}</div>
      <div className={`font-bold ${big ? 'text-2xl text-primary' : 'text-xl'} leading-tight`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </CardContent></Card>
  );
}
