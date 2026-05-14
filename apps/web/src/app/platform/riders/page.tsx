import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RidersExplorer } from './explorer';
import { PlatformRiderActions } from './row-actions';
import { Bike, Wifi, WifiOff, Wallet, Trophy } from 'lucide-react';
import { money } from '@/lib/utils';

export const metadata = { title: 'Platform · Riders' };
export const dynamic = 'force-dynamic';

export default async function PlatformRidersPage() {
  const [riders, applications, top] = await Promise.all([
    prisma.riderProfile.findMany({
      include: { user: true, branch: { include: { restaurant: { select: { name: true } } } } },
      orderBy: [{ isOnline: 'desc' }, { totalDeliveries: 'desc' }]
    }),
    prisma.riderApplication.findMany({
      where: { status: 'PENDING' },
      include: { restaurant: true },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.riderProfile.findMany({
      orderBy: { totalEarnings: 'desc' },
      take: 5,
      include: { user: { select: { name: true, phone: true } } }
    })
  ]);

  const online = riders.filter((r) => r.isOnline).length;
  const offline = riders.length - online;
  const totalEarnings = riders.reduce((s, r) => s + Number(r.totalEarnings), 0);
  const totalTips = riders.reduce((s, r) => s + Number(r.totalTips), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Riders</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform-wide pool. Any approved rider can claim any READY order.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        <Stat icon={Bike}    label="Total riders"  value={String(riders.length)}  tone="primary" />
        <Stat icon={Wifi}    label="Online now"    value={String(online)}         tone="success" />
        <Stat icon={WifiOff} label="Offline"       value={String(offline)}         tone="warning" />
        <Stat icon={Wallet}  label="Earnings paid" value={money(totalEarnings)}   tone="primary" />
        <Stat icon={Trophy}  label="Tips paid"     value={money(totalTips)}       tone="success" />
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active riders ({riders.length})</TabsTrigger>
          <TabsTrigger value="pending">Applications ({applications.length})</TabsTrigger>
          <TabsTrigger value="leaderboard">Top earners</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <RidersExplorer initial={JSON.parse(JSON.stringify(riders))} />
        </TabsContent>

        <TabsContent value="pending">
          <div className="grid gap-3">
            {applications.length === 0 && (
              <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">No pending applications.</div>
            )}
            {applications.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-5 flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-[260px]">
                    <div className="font-semibold text-lg">{a.name}</div>
                    <div className="text-sm text-muted-foreground">{a.phone} · {a.vehicleType} {a.vehicleNumber ?? ''}</div>
                    {a.preferredZone && <div className="text-xs text-muted-foreground">Zone preference: {a.preferredZone}</div>}
                    {a.restaurant && <div className="text-xs text-muted-foreground">Hint: wants to ride for {a.restaurant.name}</div>}
                    {a.notes && <p className="mt-2 text-sm">{a.notes}</p>}
                    <div className="text-[11px] text-muted-foreground mt-2">Applied {new Date(a.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
                  </div>
                  <PlatformRiderActions id={a.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leaderboard">
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Trophy className="size-4 text-warning" /> Top 5 lifetime earners</h3>
              <ul className="space-y-2">
                {top.map((r, i) => (
                  <li key={r.id} className="rounded-lg border bg-card p-3 flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-warning/10 text-warning text-sm font-bold">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.user.name ?? r.user.phone}</div>
                      <div className="text-[11px] text-muted-foreground">{r.totalDeliveries} deliveries · ⭐ {Number(r.rating ?? 0).toFixed(1)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-success">{money(r.totalEarnings as any)}</div>
                      <div className="text-[10px] text-muted-foreground">+{money(r.totalTips as any)} tips</div>
                    </div>
                  </li>
                ))}
                {top.length === 0 && <li className="text-sm text-muted-foreground text-center py-6">No earnings yet.</li>}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'primary' | 'success' | 'warning' }) {
  const cls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning' }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-lg leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
