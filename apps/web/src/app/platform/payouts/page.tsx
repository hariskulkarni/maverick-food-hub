import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PayoutRuleEditor } from './editor';
import { Coins, Activity, History } from 'lucide-react';

export const metadata = { title: 'Platform · Payout rules' };
export const dynamic = 'force-dynamic';

export default async function PayoutRulesPage() {
  const [rule, history, stats] = await Promise.all([
    prisma.deliveryPayoutRule.findFirst({ where: { isActive: true }, orderBy: { effectiveFrom: 'desc' } }),
    prisma.deliveryPayoutRule.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 20 }),
    prisma.riderAssignment.aggregate({
      where: { status: 'DELIVERED', deliveredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      _avg: { earningsAmt: true },
      _count: true,
      _sum: { earningsAmt: true }
    })
  ]);

  const avg = Number(stats._avg.earningsAmt ?? 0);
  const sum = Number(stats._sum.earningsAmt ?? 0);

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold flex items-center gap-2"><Coins className="size-7 text-primary" /> Rider payout rules</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configure how riders get paid per delivery. The active rule applies to every order claimed from the pool;
            past deliveries keep what they earned at claim time.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat icon={Activity} label="Deliveries · 30d"     value={stats._count.toLocaleString()} tone="primary" />
          <Stat icon={Coins}    label="Avg rider payout"     value={`₹${avg.toFixed(0)}`}          tone="success" />
          <Stat icon={Coins}    label="Total paid · 30d"     value={`₹${sum.toLocaleString('en-IN')}`} tone="primary" />
        </div>
      </header>

      <PayoutRuleEditor current={JSON.parse(JSON.stringify(rule ?? {}))} />

      <section>
        <h3 className="font-semibold flex items-center gap-2 mb-3"><History className="size-4 text-primary" /> Rule history</h3>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Rule</th>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Base / km</th>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Peaks</th>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Effective</th>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No history yet.</td></tr>
              )}
              {history.map((h) => (
                <tr key={h.id} className={h.isActive ? 'bg-success/5' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{h.name}</div>
                    {h.notes && <div className="text-[11px] text-muted-foreground line-clamp-1">{h.notes}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    ₹{Number(h.baseAmount).toFixed(0)} + ₹{Number(h.perKmAmount).toFixed(0)}/km
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    Lunch ₹{Number(h.lunchPeakBonus).toFixed(0)} · Dinner ₹{Number(h.dinnerPeakBonus).toFixed(0)}
                    {Number(h.weekendBonus) > 0 && ` · Wknd ₹${Number(h.weekendBonus).toFixed(0)}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(h.effectiveFrom).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                    {h.effectiveTo && <> — {new Date(h.effectiveTo).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</>}
                  </td>
                  <td className="px-4 py-3">
                    {h.isActive
                      ? <Badge variant="success">Active</Badge>
                      : <Badge variant="muted">Retired</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      </section>
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
