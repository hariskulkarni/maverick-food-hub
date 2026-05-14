import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Flame, Layers } from 'lucide-react';
import { SurgeZonesClient } from './surge-zones-client';

export const metadata = { title: 'Platform · Surge zones' };
export const dynamic = 'force-dynamic';

export default async function SurgeZonesPage() {
  const zones = await prisma.surgeZone.findMany({ orderBy: { createdAt: 'desc' } });

  const rows = zones.map((z) => ({
    id: z.id,
    name: z.name,
    label: z.label,
    centerLat: z.centerLat,
    centerLng: z.centerLng,
    radiusKm: z.radiusKm,
    multiplier: z.multiplier,
    isActive: z.isActive,
    activeFrom: z.activeFrom ? z.activeFrom.toISOString() : null,
    activeTo: z.activeTo ? z.activeTo.toISOString() : null,
    createdAt: z.createdAt.toISOString()
  }));

  const active = rows.filter((r) => r.isActive).length;
  const maxMult = rows.length ? Math.max(...rows.map((r) => r.multiplier)) : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Surge zones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Geofenced pay-multiplier areas. Riders see where (and how much) extra they&rsquo;ll earn while a zone is live.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={Layers} label="Total zones"     value={String(rows.length)} tone="primary" />
        <Stat icon={Flame}  label="Active zones"    value={String(active)}      tone="warning" />
        <Stat icon={MapPin} label="Top multiplier"  value={maxMult ? `${maxMult.toFixed(2)}×` : '—'} tone="success" />
      </div>

      <SurgeZonesClient initial={rows} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'primary' | 'success' | 'warning' }) {
  const cls = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning'
  }[tone];
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
