import { Card, CardContent } from '@/components/ui/card';
import { prisma } from '@/server/db';
import { getDispatchInsights, istToday } from '@/server/dispatch/insights';
import { getJitConfig } from '@/server/dispatch/settings';
import { log } from '@/server/log';

/**
 * Kitchen & dispatch (last 30 IST days) for one restaurant: how often the
 * kitchen taps "Food ready", how accurate prep predictions are, and how long
 * food / riders wait. Server component; one aggregate SQL round-trip.
 */
export async function DispatchCard({ restaurantId }: { restaurantId: string }) {
  const to = istToday();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  let data: Awaited<ReturnType<typeof getDispatchInsights>> | null = null;
  try {
    const cfg = await getJitConfig();
    data = await getDispatchInsights({ from, to, restaurantId }, { slaMin: cfg.promiseSlaMin, includeRestaurants: false, includeZones: false });
  } catch (e) {
    log.error({ err: (e as Error).message, restaurantId }, 'dispatch card failed');
  }
  const prep = await prisma.restaurantPrepStat.findUnique({
    where: { restaurantId_hourBucket: { restaurantId, hourBucket: -1 } },
    select: { samples: true, p50Min: true, p90Min: true },
  }).catch(() => null);
  if (!data) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Kitchen &amp; dispatch stats are unavailable right now.</CardContent></Card>;
  }
  const s = data.summary;
  const m = (v: number | null) => (v == null ? '—' : `${v} min`);
  return (
    <Card><CardContent className="p-5">
      <h3 className="font-semibold">Kitchen &amp; dispatch (30 days)</h3>
      <p className="mb-3 text-xs text-muted-foreground">Tap <span className="font-medium">Food ready</span> on the kitchen board the moment food is packed — it times rider arrival and sharpens your prep estimate.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Food-ready tap rate" value={s.readyTapRatePct == null ? '—' : `${s.readyTapRatePct}%`} />
        <Stat label="Typical prep (P50 / P90)" value={prep && prep.samples > 0 ? `${prep.p50Min} / ${prep.p90Min} min` : '—'} hint={prep ? `${prep.samples} orders, nightly` : 'computed nightly'} />
        <Stat label="Food waiting for rider" value={m(s.foodWaitingForRiderMin.p50)} />
        <Stat label="Rider wait at your counter" value={m(s.riderWaitAtRestaurantMin.p50)} />
        <Stat label="Prep estimate error" value={s.prepError.maeMin == null ? '—' : `±${s.prepError.maeMin} min`} />
        <Stat label="On time vs promise" value={s.onTimePct == null ? '—' : `${s.onTimePct}%`} />
        <Stat label="Delivery orders" value={String(s.orders)} />
        <Stat label="Unassigned > 5 min now" value={String(data.unassignedOver5MinLive)} />
      </div>
    </CardContent></Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
