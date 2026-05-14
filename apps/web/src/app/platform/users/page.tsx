import { prisma } from '@/server/db';
import { UsersExplorer } from './explorer';
import { Card, CardContent } from '@/components/ui/card';
import { Users, UserCog, Bike, ChefHat, ShoppingBag } from 'lucide-react';

export const metadata = { title: 'Platform · Users' };
export const dynamic = 'force-dynamic';

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<{ role?: string; q?: string; period?: string }> }) {
  const sp = await searchParams;
  const role = (sp.role || '').toUpperCase();
  const q = sp.q ?? '';
  const period = sp.period ?? 'all';

  const since =
    period === '7d' ? new Date(Date.now() - 7 * 86_400_000)
    : period === '30d' ? new Date(Date.now() - 30 * 86_400_000)
    : period === '90d' ? new Date(Date.now() - 90 * 86_400_000)
    : null;

  const where: any = {};
  if (role && ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER', 'SUPER_ADMIN'].includes(role)) where.role = role;
  if (since) where.createdAt = { gte: since };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } }
    ];
  }

  const [users, counts] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { _count: { select: { orders: true } } }
    }),
    prisma.user.groupBy({ by: ['role'], _count: true })
  ]);

  const total = counts.reduce((s, c) => s + c._count, 0);
  const byRole: Record<string, number> = {};
  for (const c of counts) byRole[c.role] = c._count;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">Everyone on the platform — customers, restaurant staff, riders, and admins.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard icon={Users}      label="Total people"  value={total}                color="primary" />
        <StatCard icon={ShoppingBag} label="Customers"    value={byRole.CUSTOMER ?? 0} color="success" />
        <StatCard icon={Bike}       label="Riders"        value={byRole.RIDER ?? 0}    color="warning" />
        <StatCard icon={ChefHat}    label="Restaurant staff" value={(byRole.ADMIN ?? 0) + (byRole.KITCHEN ?? 0)} color="primary" />
        <StatCard icon={UserCog}    label="Super admins"  value={byRole.SUPER_ADMIN ?? 0} color="destructive" />
      </div>

      <UsersExplorer
        initial={JSON.parse(JSON.stringify(users))}
        filters={{ role, q, period }}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: 'primary' | 'success' | 'warning' | 'destructive' }) {
  const cls = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', destructive: 'bg-destructive/10 text-destructive' }[color];
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
