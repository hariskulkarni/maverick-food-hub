'use client';
/**
 * Admin feedback dashboard — client side.
 *
 * Surfaces:
 *   • KPI strip — Avg Food / Avg Overall / Total Feedback / Low-rated %
 *   • Filter chips — All / Low-rated only (≤ 2 on any visible axis)
 *   • Date range chips — 7d / 30d / 90d (re-fetches via /api/admin/feedback)
 *   • Tag cloud — 7 issue tags with counts, food-related tags larger
 *   • Sortable table — order code, food, overall, tags, comment, time
 *
 * All ratings are food/overall only. Delivery rating is omitted by the
 * server — we never even receive it. (And the type below reflects that.)
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star, MessageSquare, AlertTriangle, ArrowUpRight, Loader2, Filter } from 'lucide-react';
import { toast } from 'sonner';

interface Row {
  id: string;
  orderId: string;
  foodRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: string[];
  imageUrl: string | null;
  createdAt: string;
  order: { id: string; code: string | null; total: any };
}

interface Summary {
  count: number;
  avgFood: number | null;
  avgOverall: number | null;
  lowFoodCount: number;
  lowOverallCount: number;
  tagCounts: Record<string, number>;
}

const FOOD_TAGS = new Set(['MISSING_ITEM', 'WRONG_ITEM', 'COLD_FOOD', 'PACKAGING_ISSUE', 'FOOD_QUALITY']);
const ALL_TAGS = ['MISSING_ITEM', 'WRONG_ITEM', 'COLD_FOOD', 'PACKAGING_ISSUE', 'FOOD_QUALITY', 'LATE_DELIVERY', 'RIDER_BEHAVIOR'];
const TAG_LABEL: Record<string, string> = {
  MISSING_ITEM: 'Missing item', WRONG_ITEM: 'Wrong item', COLD_FOOD: 'Cold food',
  PACKAGING_ISSUE: 'Packaging issue', FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery', RIDER_BEHAVIOR: 'Rider behaviour'
};

type Period = '7d' | '30d' | '90d';
type Sort = 'newest' | 'oldest' | 'food-asc' | 'food-desc' | 'overall-asc' | 'overall-desc';

export function FeedbackClient({ initialRows, initialSummary }: { initialRows: Row[]; initialSummary: Summary }) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [period, setPeriod] = useState<Period>('30d');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('newest');
  const [loading, setLoading] = useState(false);

  // Re-fetch whenever the period or low-only filter changes. We always pull
  // through /api/admin/feedback so the ADMIN role gate is applied server-side.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      setLoading(true);
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      const sp = new URLSearchParams();
      sp.set('from', from.toISOString());
      sp.set('to', to.toISOString());
      if (lowOnly) sp.set('lowOnly', '1');
      try {
        const r = await fetch(`/api/admin/feedback?${sp.toString()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setRows(j.rows);
        setSummary(j.summary);
      } catch (e: any) {
        if (!cancelled) toast.error('Failed to load feedback', { description: e?.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    pull();
    return () => { cancelled = true; };
  }, [period, lowOnly]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const cmpNum = (a: number | null, b: number | null) => (a ?? -1) - (b ?? -1);
    switch (sort) {
      case 'newest': arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); break;
      case 'oldest': arr.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)); break;
      case 'food-asc': arr.sort((a, b) => cmpNum(a.foodRating, b.foodRating)); break;
      case 'food-desc': arr.sort((a, b) => cmpNum(b.foodRating, a.foodRating)); break;
      case 'overall-asc': arr.sort((a, b) => cmpNum(a.overallRating, b.overallRating)); break;
      case 'overall-desc': arr.sort((a, b) => cmpNum(b.overallRating, a.overallRating)); break;
    }
    return arr;
  }, [rows, sort]);

  const lowPct = summary.count > 0
    ? Math.round(((summary.lowFoodCount + summary.lowOverallCount) / (summary.count * 2)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Avg Food" value={summary.avgFood != null ? summary.avgFood.toFixed(1) : '—'} icon={<Star className="size-4" />} />
        <Kpi label="Avg Overall" value={summary.avgOverall != null ? summary.avgOverall.toFixed(1) : '—'} icon={<Star className="size-4" />} />
        <Kpi label="Total Feedback" value={String(summary.count)} icon={<MessageSquare className="size-4" />} />
        <Kpi label="Low-Rated %" value={`${lowPct}%`} icon={<AlertTriangle className="size-4" />} tone={lowPct >= 20 ? 'danger' : 'default'} />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Chip active={!lowOnly} onClick={() => setLowOnly(false)}>All</Chip>
            <Chip active={lowOnly} onClick={() => setLowOnly(true)}>Low-rated only (≤2)</Chip>
            <span className="text-xs text-muted-foreground ml-3 mr-1">Range:</span>
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>{p}</Chip>
            ))}
            {loading && <Loader2 className="size-4 ml-2 animate-spin text-muted-foreground" />}
          </div>

          {/* Tag cloud — food tags rendered larger to draw the admin's eye */}
          <div className="flex flex-wrap items-baseline gap-2 pt-1">
            {ALL_TAGS.map((t) => {
              const n = summary.tagCounts?.[t] ?? 0;
              const food = FOOD_TAGS.has(t);
              const sizeCls = food ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5';
              const dim = n === 0 ? 'opacity-40' : '';
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 rounded-full border ${food ? 'bg-warning/10 border-warning/30 text-warning' : 'bg-muted text-muted-foreground'} ${sizeCls} ${dim}`}
                  title={TAG_LABEL[t]}
                >
                  {TAG_LABEL[t]} <span className="font-mono font-semibold">{n}</span>
                </span>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Order</Th>
                  <Th onClick={() => setSort(sort === 'food-desc' ? 'food-asc' : 'food-desc')} sortable>Food</Th>
                  <Th onClick={() => setSort(sort === 'overall-desc' ? 'overall-asc' : 'overall-desc')} sortable>Overall</Th>
                  <Th>Tags</Th>
                  <Th>Comment</Th>
                  <Th onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')} sortable>When</Th>
                  <Th align="right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.length === 0 && !loading && (
                  <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">No feedback in this range.</td></tr>
                )}
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{r.order.code ?? '—'}</td>
                    <td className="px-4 py-3"><Stars value={r.foodRating} /></td>
                    <td className="px-4 py-3"><Stars value={r.overallRating} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.issueTags.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        {r.issueTags.map((t) => (
                          <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <span className="text-xs text-muted-foreground line-clamp-2">{r.comment ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/orders/${r.order.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        Open order <ArrowUpRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, tone = 'default' }: { label: string; value: string; icon: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs">{label}</span>
          <span className={tone === 'danger' ? 'text-destructive' : ''}>{icon}</span>
        </div>
        <div className={`text-2xl font-semibold mt-1 ${tone === 'danger' ? 'text-destructive' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function Th({ children, align = 'left', sortable, onClick }: { children: React.ReactNode; align?: 'left' | 'right'; sortable?: boolean; onClick?: () => void }) {
  const cls = `text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground ${sortable ? 'cursor-pointer hover:text-foreground' : ''}`;
  return <th className={cls} onClick={onClick}>{children}</th>;
}

function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-3.5 ${i <= value ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`} />
      ))}
    </span>
  );
}
