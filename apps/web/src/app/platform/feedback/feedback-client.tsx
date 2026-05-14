'use client';
/**
 * Platform feedback — three sub-tabs.
 *
 *   Overview  Avg ratings per restaurant, sortable, plus the top-10 worst
 *             offenders (most overallRating ≤ 2 reviews).
 *   By Rider  Same shape but grouped by rider — lets the super-admin spot
 *             misbehaving or under-performing riders.
 *   Recent    Flat newest-first list with full visibility (comments and all)
 *             — every row was projected through visibleForRole(_, 'SUPER_ADMIN').
 *
 * Aggregates and rows arrive pre-bucketed from the server. Sorting and tab
 * switching are local — date range changes would round-trip via the API.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Star, AlertTriangle, MessageSquare, TrendingDown } from 'lucide-react';

interface SummaryBucket {
  count: number;
  avgFood: number | null;
  avgDelivery: number | null;
  avgOverall: number | null;
  lowFoodCount: number;
  lowDeliveryCount: number;
  lowOverallCount: number;
  tagCounts: Record<string, number>;
}

interface RestaurantRow extends SummaryBucket { restaurantId: string; name: string; }
interface RiderRow extends SummaryBucket { riderId: string; name: string; phone: string | null; }

interface RecentRow {
  id: string;
  orderId: string;
  foodRating: number | null;
  deliveryRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: string[];
  imageUrl: string | null;
  createdAt: string;
  order: { id: string; code: string | null; restaurant: string | null; rider: string | null };
}

const TAG_LABEL: Record<string, string> = {
  MISSING_ITEM: 'Missing item', WRONG_ITEM: 'Wrong item', COLD_FOOD: 'Cold food',
  PACKAGING_ISSUE: 'Packaging issue', FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery', RIDER_BEHAVIOR: 'Rider behaviour'
};

export function FeedbackClient({ initial }: { initial: { overall: SummaryBucket; byRestaurant: RestaurantRow[]; byRider: RiderRow[]; recent: RecentRow[] } }) {
  const [restaurantSort, setRestaurantSort] = useState<'overall' | 'low' | 'count' | 'name'>('low');
  const [riderSort, setRiderSort] = useState<'delivery' | 'low' | 'count' | 'name'>('low');

  const sortedRestaurants = useMemo(() => {
    const arr = [...initial.byRestaurant];
    switch (restaurantSort) {
      case 'overall': arr.sort((a, b) => (a.avgOverall ?? 99) - (b.avgOverall ?? 99)); break;
      case 'low':     arr.sort((a, b) => b.lowOverallCount - a.lowOverallCount); break;
      case 'count':   arr.sort((a, b) => b.count - a.count); break;
      case 'name':    arr.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return arr;
  }, [initial.byRestaurant, restaurantSort]);

  const sortedRiders = useMemo(() => {
    const arr = [...initial.byRider];
    switch (riderSort) {
      case 'delivery': arr.sort((a, b) => (a.avgDelivery ?? 99) - (b.avgDelivery ?? 99)); break;
      case 'low':      arr.sort((a, b) => b.lowDeliveryCount - a.lowDeliveryCount); break;
      case 'count':    arr.sort((a, b) => b.count - a.count); break;
      case 'name':     arr.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return arr;
  }, [initial.byRider, riderSort]);

  const topLow = useMemo(() => [...initial.byRestaurant].sort((a, b) => b.lowOverallCount - a.lowOverallCount).slice(0, 10), [initial.byRestaurant]);

  return (
    <>
      {/* Overall KPI strip is always visible */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total feedback" value={String(initial.overall.count)} icon={<MessageSquare className="size-4" />} />
        <Kpi label="Avg food" value={fmtAvg(initial.overall.avgFood)} icon={<Star className="size-4" />} />
        <Kpi label="Avg delivery" value={fmtAvg(initial.overall.avgDelivery)} icon={<Star className="size-4" />} />
        <Kpi label="Avg overall" value={fmtAvg(initial.overall.avgOverall)} icon={<Star className="size-4" />} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="riders">By Rider</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="p-0">
                <div className="p-4 border-b flex items-center gap-2">
                  <h3 className="font-semibold">Avg ratings per restaurant</h3>
                  <select value={restaurantSort} onChange={(e) => setRestaurantSort(e.target.value as any)} className="ml-auto h-8 rounded-md border bg-card px-2 text-xs">
                    <option value="low">Most low-rated</option>
                    <option value="overall">Lowest overall avg</option>
                    <option value="count">Most feedback</option>
                    <option value="name">Name</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <Th>Restaurant</Th>
                        <Th align="right">Count</Th>
                        <Th align="right">Food</Th>
                        <Th align="right">Delivery</Th>
                        <Th align="right">Overall</Th>
                        <Th align="right">Low ≤2</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sortedRestaurants.length === 0 && (
                        <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No feedback in this range.</td></tr>
                      )}
                      {sortedRestaurants.map((r) => (
                        <tr key={r.restaurantId} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium">{r.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtAvg(r.avgFood)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtAvg(r.avgDelivery)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtAvg(r.avgOverall)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {r.lowOverallCount > 0 ? <Badge variant="destructive" className="text-[10px]">{r.lowOverallCount}</Badge> : <span className="text-muted-foreground">0</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold flex items-center gap-2 mb-3"><TrendingDown className="size-4 text-destructive" /> Top 10 low-rated</h3>
                <ul className="space-y-2 text-sm">
                  {topLow.filter((r) => r.lowOverallCount > 0).length === 0 && (
                    <li className="text-muted-foreground text-xs">No restaurants with overall ≤ 2 in this range.</li>
                  )}
                  {topLow.filter((r) => r.lowOverallCount > 0).map((r) => (
                    <li key={r.restaurantId} className="flex items-center justify-between">
                      <span className="truncate">{r.name}</span>
                      <Badge variant="destructive" className="text-[10px]">{r.lowOverallCount}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── By Rider tab ─────────────────────────────────────────── */}
        <TabsContent value="riders">
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b flex items-center gap-2">
                <h3 className="font-semibold">Ratings per rider</h3>
                <select value={riderSort} onChange={(e) => setRiderSort(e.target.value as any)} className="ml-auto h-8 rounded-md border bg-card px-2 text-xs">
                  <option value="low">Most low-rated</option>
                  <option value="delivery">Lowest delivery avg</option>
                  <option value="count">Most feedback</option>
                  <option value="name">Name</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <Th>Rider</Th>
                      <Th>Phone</Th>
                      <Th align="right">Count</Th>
                      <Th align="right">Avg delivery</Th>
                      <Th align="right">Low ≤2</Th>
                      <Th>Top tags</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedRiders.length === 0 && (
                      <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No rider feedback in this range.</td></tr>
                    )}
                    {sortedRiders.map((r) => (
                      <tr key={r.riderId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.phone ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtAvg(r.avgDelivery)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.lowDeliveryCount > 0 ? <Badge variant="destructive" className="text-[10px]">{r.lowDeliveryCount}</Badge> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(r.tagCounts).filter(([t]) => t === 'LATE_DELIVERY' || t === 'RIDER_BEHAVIOR').slice(0, 3).map(([t, n]) => (
                              <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t} {n}</Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Recent tab ───────────────────────────────────────────── */}
        <TabsContent value="recent">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <Th>Order</Th>
                      <Th>Restaurant</Th>
                      <Th>Rider</Th>
                      <Th align="right">Food</Th>
                      <Th align="right">Delivery</Th>
                      <Th align="right">Overall</Th>
                      <Th>Tags</Th>
                      <Th>Comment</Th>
                      <Th>When</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {initial.recent.length === 0 && (
                      <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">No recent feedback.</td></tr>
                    )}
                    {initial.recent.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs">{r.order.code ?? '—'}</td>
                        <td className="px-4 py-3 text-xs">{r.order.restaurant ?? '—'}</td>
                        <td className="px-4 py-3 text-xs">{r.order.rider ?? '—'}</td>
                        <td className="px-4 py-3 text-right"><Stars value={r.foodRating} /></td>
                        <td className="px-4 py-3 text-right"><Stars value={r.deliveryRating} /></td>
                        <td className="px-4 py-3 text-right"><Stars value={r.overallRating} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.issueTags.map((t) => (
                              <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[240px]">
                          <span className="text-xs text-muted-foreground line-clamp-2">{r.comment ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs">{label}</span>{icon}
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-3 ${i <= value ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`} />
      ))}
    </span>
  );
}

function fmtAvg(n: number | null): string {
  return n == null ? '—' : n.toFixed(1);
}
