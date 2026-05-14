'use client';
/**
 * Rider tiers read view. Distribution cards up top double as tier filters;
 * the table is sortable by tier, deliveries, rating or earnings. No mutations.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/utils';
import { ArrowUpDown, Award, Bike } from 'lucide-react';

export type RiderTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface TierRow {
  id: string;
  name: string | null;
  phone: string | null;
  riderType: 'FLEET' | 'DEDICATED';
  totalDeliveries: number;
  rating: number;
  totalEarnings: number;
  tier: RiderTier;
}

const TIER_ORDER: RiderTier[] = ['PLATINUM', 'GOLD', 'SILVER', 'BRONZE'];
const TIER_RANK: Record<RiderTier, number> = { PLATINUM: 0, GOLD: 1, SILVER: 2, BRONZE: 3 };

const TIER_STYLE: Record<RiderTier, { badge: 'default' | 'success' | 'warning' | 'muted'; chip: string }> = {
  PLATINUM: { badge: 'default',  chip: 'bg-primary/10 text-primary border-primary/30' },
  GOLD:     { badge: 'warning',  chip: 'bg-warning/10 text-warning border-warning/30' },
  SILVER:   { badge: 'success',  chip: 'bg-success/10 text-success border-success/30' },
  BRONZE:   { badge: 'muted',    chip: 'bg-muted text-muted-foreground border-transparent' }
};

type SortKey = 'tier' | 'deliveries' | 'rating' | 'earnings' | 'name';
type SortDir = 'asc' | 'desc';

export function RiderTiersClient({ rows, distribution }: {
  rows: TierRow[]; distribution: Record<RiderTier, number>;
}) {
  const [filter, setFilter] = useState<RiderTier | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('tier');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const visible = useMemo(() => {
    let r = filter === 'ALL' ? rows.slice() : rows.filter((x) => x.tier === filter);
    r.sort((a, b) => {
      let av: number | string; let bv: number | string;
      switch (sortKey) {
        case 'tier':       av = TIER_RANK[a.tier]; bv = TIER_RANK[b.tier]; break;
        case 'deliveries': av = a.totalDeliveries; bv = b.totalDeliveries; break;
        case 'rating':     av = a.rating; bv = b.rating; break;
        case 'earnings':   av = a.totalEarnings; bv = b.totalEarnings; break;
        case 'name':       av = a.name ?? a.phone ?? ''; bv = b.name ?? b.phone ?? ''; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return r;
  }, [rows, filter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'tier' || k === 'name' ? 'asc' : 'desc'); }
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        {TIER_ORDER.map((t) => {
          const style = TIER_STYLE[t];
          const active = filter === t;
          return (
            <button
              key={t}
              onClick={() => setFilter(active ? 'ALL' : t)}
              className="text-left"
            >
              <Card className={active ? 'ring-2 ring-primary' : ''}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`grid size-10 place-items-center rounded-lg shrink-0 border ${style.chip}`}>
                    <Award className="size-5" />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{t}</div>
                    <div className="font-bold text-lg leading-tight">{distribution[t]} rider{distribution[t] === 1 ? '' : 's'}</div>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-xs text-muted-foreground">
              {filter === 'ALL' ? 'All riders' : `${filter} riders`} · {visible.length}
            </span>
            {filter !== 'ALL' && (
              <button onClick={() => setFilter('ALL')} className="text-xs text-primary hover:underline">Clear filter</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <ThSort label="Rider"      k="name"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Tier"       k="tier"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Type</th>
                  <ThSort label="Deliveries" k="deliveries" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <ThSort label="Rating"     k="rating"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <ThSort label="Earnings"   k="earnings"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.length === 0 && (
                  <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No riders in this tier.</td></tr>
                )}
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs truncate max-w-[180px]">{r.name ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{r.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={TIER_STYLE[r.tier].badge} className="text-[10px]">{r.tier}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Bike className="size-3.5" /> {r.riderType === 'FLEET' ? 'Fleet' : 'Dedicated'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.totalDeliveries.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.rating.toFixed(2)}★</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(r.totalEarnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ThSort({ label, k, sortKey, sortDir, onClick, align = 'left' }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>
      <button onClick={() => onClick(k)} className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : ''}`}>
        {label} <ArrowUpDown className={`size-3 ${active ? '' : 'opacity-50'}`} />
        {active && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
