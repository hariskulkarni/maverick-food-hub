import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money, fmtDate } from '@/lib/utils';

export const metadata = { title: 'Rider · History' };

export default async function RiderHistory() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/rider/history');
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return <div>No rider profile</div>;
  const assignments = await prisma.riderAssignment.findMany({
    where: { riderId: profile.id, status: 'DELIVERED' },
    include: { order: { include: { customer: true } } },
    orderBy: { deliveredAt: 'desc' },
    take: 50
  });
  return (
    <div className="space-y-3">
      <h1 className="display text-xl font-semibold">Recent deliveries</h1>
      {assignments.map((a) => (
        <Card key={a.id}><CardContent className="p-4 text-sm">
          <div className="flex justify-between"><span className="font-mono">{a.order.code}</span><span>{money(a.order.total as any)}</span></div>
          <div className="text-muted-foreground">{a.order.customer.name} · {fmtDate(a.deliveredAt!)}</div>
        </CardContent></Card>
      ))}
      {assignments.length === 0 && <p className="text-sm text-muted-foreground">No deliveries yet.</p>}
    </div>
  );
}
