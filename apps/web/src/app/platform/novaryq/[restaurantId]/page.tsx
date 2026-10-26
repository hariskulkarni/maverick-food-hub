import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { NovaryqPanel } from '@/app/admin/integrations/novaryq-panel';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const metadata = { title: 'Platform · Novaryq POS · Restaurant' };
export const dynamic = 'force-dynamic';

/**
 * Super-admin management of one restaurant's Novaryq integration: the same panel as the
 * restaurant's own Admin → POS integration, scoped with ?restaurantId= (SUPER_ADMIN only).
 */
export default async function PlatformNovaryqRestaurantPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  await requireSuperAdmin();
  const { restaurantId } = await params;
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, slug: true, status: true, branches: { select: { city: true }, take: 1 } },
  });
  if (!r) notFound();

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <Link href="/platform/novaryq" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All restaurants
      </Link>
      <header className="space-y-2">
        <h1 className="display text-2xl sm:text-3xl font-semibold">{r.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={r.status === 'ACTIVE' ? 'success' : 'muted'}>{String(r.status).toLowerCase()}</Badge>
          <span>/r/{r.slug}</span>
          {r.branches[0]?.city && <span>· {r.branches[0].city}</span>}
        </div>
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          You are managing this restaurant&apos;s Novaryq integration as the platform team. Every change is audited with your
          account, and the restaurant&apos;s admins see the same settings under Admin → POS integration.
        </p>
      </header>
      <NovaryqPanel restaurantId={r.id} />
    </div>
  );
}
