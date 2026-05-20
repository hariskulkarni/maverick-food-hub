import Link from 'next/link';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RestaurantsExplorer } from './explorer';
import { Building2, CheckCircle2, Clock, Pause, XCircle, Plus, Network } from 'lucide-react';

export const metadata = { title: 'Platform · Restaurants' };
export const dynamic = 'force-dynamic';

export default async function PlatformRestaurantsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; cuisine?: string }> }) {
  const sp = await searchParams;
  const status = (sp.status || '').toUpperCase();
  const q = sp.q ?? '';
  const cuisine = sp.cuisine ?? '';

  const where: any = {};
  if (['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'].includes(status)) where.status = status;
  if (cuisine) where.cuisine = cuisine;
  if (q) {
    where.OR = [
      { name:    { contains: q, mode: 'insensitive' } },
      { tagline: { contains: q, mode: 'insensitive' } },
      { cuisine: { contains: q, mode: 'insensitive' } },
      { slug:    { contains: q, mode: 'insensitive' } }
    ];
  }

  const [rows, statusGroups, cuisines, groupTops] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      include: { owner: { select: { name: true, email: true } }, _count: { select: { branches: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    }),
    prisma.restaurant.groupBy({ by: ['status'], _count: true }),
    prisma.restaurant.findMany({ where: { cuisine: { not: null } }, distinct: ['cuisine'], select: { cuisine: true } }),
    // Group tree: top-level restaurants that actually have children.
    prisma.restaurant.findMany({
      where: { parentId: null, children: { some: {} } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, children: { orderBy: { name: 'asc' }, select: { id: true, name: true, status: true } } }
    })
  ]);

  const counts = { ALL: 0, PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 } as Record<string, number>;
  for (const g of statusGroups) { counts[g.status] = g._count; counts.ALL += g._count; }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-semibold">Restaurants</h1>
          <p className="text-sm text-muted-foreground mt-1">Approve, suspend, and inspect every restaurant on the platform.</p>
        </div>
        <Link href="/platform/restaurants/new">
          <Button><Plus className="size-4" /> New restaurant</Button>
        </Link>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard icon={Building2}   label="Total"     value={counts.ALL}        tone="primary" />
        <StatCard icon={Clock}       label="Pending"   value={counts.PENDING}    tone="warning" />
        <StatCard icon={CheckCircle2} label="Active"   value={counts.ACTIVE}     tone="success" />
        <StatCard icon={Pause}       label="Suspended" value={counts.SUSPENDED}  tone="destructive" />
        <StatCard icon={XCircle}     label="Rejected"  value={counts.REJECTED}   tone="destructive" />
      </div>

      {groupTops.length > 0 && (
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Network className="size-4" /> Restaurant groups</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {groupTops.map((g) => (
              <div key={g.id} className="rounded-lg border p-3">
                <div className="font-medium flex items-center gap-2">{g.name}<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Parent · {g.children.length}</span></div>
                <ul className="mt-2 space-y-1 text-sm">
                  {g.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between pl-4 border-l ml-1 py-0.5">
                      <span className="text-muted-foreground">↳ {c.name}</span>
                      <span className="text-[10px] text-muted-foreground">{c.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <RestaurantsExplorer
        initial={JSON.parse(JSON.stringify(rows))}
        cuisines={cuisines.map((c) => c.cuisine!).filter(Boolean)}
        filters={{ status, q, cuisine }}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'primary' | 'success' | 'warning' | 'destructive' }) {
  const cls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', destructive: 'bg-destructive/10 text-destructive' }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-xl leading-tight">{value.toLocaleString('en-IN')}</div>
        </div>
      </CardContent>
    </Card>
  );
}
