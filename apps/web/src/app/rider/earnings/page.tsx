import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { StatementButton } from './statement-button';

export const metadata = { title: 'Rider · Earnings' };

export default async function RiderEarnings() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/rider/earnings');
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return <div>No rider profile</div>;

  const assignments = await prisma.riderAssignment.findMany({
    where: { riderId: profile.id, status: 'DELIVERED' },
    orderBy: { deliveredAt: 'desc' },
    take: 60
  });
  const today = assignments.filter((a) => a.deliveredAt && a.deliveredAt > new Date(Date.now() - 86_400_000));
  const week  = assignments.filter((a) => a.deliveredAt && a.deliveredAt > new Date(Date.now() - 7 * 86_400_000));
  const sum = (xs: typeof assignments, field: 'baseEarningsAmt'|'bonusAmt'|'tipAmt'|'earningsAmt') =>
    xs.reduce((s, a) => s + Number((a as any)[field] ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="display text-xl font-semibold">Earnings</h1>

      <Card><CardContent className="p-5">
        <div className="text-xs uppercase text-muted-foreground tracking-wide">Today</div>
        <div className="display text-3xl font-semibold mt-1">{money(sum(today,'earningsAmt'))}</div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
          <Mini label="Base" value={money(sum(today,'baseEarningsAmt'))} />
          <Mini label="Bonus" value={money(sum(today,'bonusAmt'))} />
          <Mini label="Tips" value={money(sum(today,'tipAmt'))} accent="success" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{today.length} deliveries today</p>
      </CardContent></Card>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">This week</div>
          <div className="text-xl font-semibold">{money(sum(week,'earningsAmt'))}</div>
          <div className="text-xs">{week.length} deliveries</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Lifetime</div>
          <div className="text-xl font-semibold">{money(Number(profile.totalEarnings))}</div>
          <div className="text-xs">+ {money(Number(profile.totalTips))} in tips</div>
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-2">Recent deliveries</h3>
        <ul className="text-sm divide-y">
          {assignments.slice(0,15).map((a) => (
            <li key={a.id} className="flex justify-between py-2">
              <span className="text-muted-foreground">{a.deliveredAt ? new Date(a.deliveredAt).toLocaleDateString('en-IN') : ''}</span>
              <span>{money(a.earningsAmt as any)}{Number(a.tipAmt) > 0 && <span className="ml-2 text-success text-xs">+{money(a.tipAmt as any)} tip</span>}</span>
            </li>
          ))}
        </ul>
      </CardContent></Card>

      <StatementButton />

      <p className="text-xs text-muted-foreground">Platform team sets per-delivery payouts and bonuses. Customers add tips post-delivery.</p>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'success' }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-medium text-sm ${accent === 'success' ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}
