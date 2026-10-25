'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, MessageSquareReply, RefreshCw, Star, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';

type Insights = {
  periodDays: number;
  totals: { reviews: number; average: number | null; replyRate: number | null; medianReplyHours: number | null; overdue: number };
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  weekly: Array<{ week: string; count: number; average: number | null }>;
  dishes: Array<{ name: string; mentions: number; positivePct: number }>;
  issues: Array<{ key: string; label: string; count: number }>;
  staffMentions: Array<{ name: string; mentions: number }>;
  analysis: { analyzed: number; method: 'llm' | 'keyword' | 'mixed' | 'none' };
  google: { average: number | null; total: number | null } | null;
  computedAt: string;
};

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={cn('h-full rounded-full bg-primary', className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

const METHOD: Record<Insights['analysis']['method'], string> = {
  llm: 'Topics extracted with your AI key',
  keyword: 'Topics from keyword matching (add an AI key in Settings → Reviews for richer analysis)',
  mixed: 'Topics from your AI key, with keyword matching where the AI was unavailable',
  none: 'No reviews analysed yet',
};

export function InsightsClient() {
  const [data, setData] = useState<Insights | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/insights${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load insights'); return; }
      setData(await r.json());
      if (refresh) toast.success('Insights refreshed');
    } catch {
      toast.error('Could not load insights');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const distTotal = data ? Object.values(data.distribution).reduce((a, b) => a + b, 0) : 0;
  const maxWeek = data ? Math.max(1, ...data.weekly.map((w) => w.count)) : 1;
  const maxIssue = data ? Math.max(1, ...data.issues.map((i) => i.count)) : 1;

  return (
    <div className="space-y-6 overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/reviews" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Reviews
          </Link>
          <h1 className="display text-2xl font-semibold leading-tight"><span className="text-gradient-brand">Review insights</span></h1>
          <p className="text-sm text-muted-foreground">
            Last {data?.periodDays ?? 90} days of Google reviews{data ? ` · updated ${new Date(data.computedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <Button variant="outline" className="min-h-[44px] gap-2 rounded-full" disabled={busy} onClick={() => load(true)}>
          <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} aria-hidden="true" /> Refresh
        </Button>
      </header>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading insights">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border bg-muted/40" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<Star className="h-3.5 w-3.5" aria-hidden="true" />} label="Average rating" value={t?.average != null ? t.average.toFixed(1) : '—'}
              hint={data.google?.average != null ? `Overall on Google: ${data.google.average.toFixed(1)} from ${data.google.total ?? '?'} reviews` : `${t?.reviews ?? 0} reviews in period`} />
            <Stat icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />} label="Reviews" value={String(t?.reviews ?? 0)} hint={`Last ${data.periodDays} days`} />
            <Stat icon={<MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />} label="Reply rate" value={t?.replyRate != null ? `${t.replyRate}%` : '—'}
              hint={t?.medianReplyHours != null ? `Median reply time ${t.medianReplyHours}h` : 'No replies yet'} />
            <Stat icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />} label="Overdue replies" value={String(t?.overdue ?? 0)}
              hint={t?.overdue ? 'Past your reply target' : 'All caught up'} />
          </div>
          {!!t?.overdue && (
            <Link href="/admin/reviews?overdue=1" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline">
              Reply to overdue reviews
            </Link>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl"><CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Weekly trend</h2>
              {data.weekly.length === 0 ? <p className="text-sm text-muted-foreground">No reviews in this period.</p> : (
                <ul className="space-y-2">
                  {data.weekly.map((w) => (
                    <li key={w.week} className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{new Date(w.week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      <Bar pct={(w.count / maxWeek) * 100} />
                      <span className="text-right tabular-nums">{w.count} · {w.average?.toFixed(1) ?? '—'}★</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>

            <Card className="rounded-2xl"><CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Rating distribution</h2>
              <ul className="space-y-2">
                {(['5', '4', '3', '2', '1'] as const).map((k) => (
                  <li key={k} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-0.5">{k}<Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" /></span>
                    <Bar pct={distTotal ? (data.distribution[k] / distTotal) * 100 : 0} className="bg-amber-400" />
                    <span className="text-right tabular-nums">{data.distribution[k]}</span>
                  </li>
                ))}
              </ul>
            </CardContent></Card>

            <Card className="rounded-2xl"><CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Dishes guests mention</h2>
              {data.dishes.length === 0 ? <p className="text-sm text-muted-foreground">No menu dishes mentioned yet.</p> : (
                <ul className="space-y-2">
                  {data.dishes.map((d) => (
                    <li key={d.name} className="space-y-1 text-sm">
                      <div className="flex flex-wrap justify-between gap-x-2">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-xs text-muted-foreground">{d.mentions} mention{d.mentions === 1 ? '' : 's'}, {d.positivePct}% positive</span>
                      </div>
                      <Bar pct={d.positivePct} className={d.positivePct >= 60 ? 'bg-success' : d.positivePct >= 40 ? 'bg-warning' : 'bg-destructive'} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>

            <Card className="rounded-2xl"><CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Recurring issues</h2>
              {data.issues.length === 0 ? <p className="text-sm text-muted-foreground">No recurring issues found.</p> : (
                <ul className="space-y-2">
                  {data.issues.map((i) => (
                    <li key={i.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-xs">
                      <span className="truncate">{i.label}</span>
                      <Bar pct={(i.count / maxIssue) * 100} className="bg-destructive/70" />
                      <span className="text-right tabular-nums">{i.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>
          </div>

          <Card className="rounded-2xl"><CardContent className="space-y-2 p-4">
            <h2 className="font-semibold">Team names mentioned</h2>
            <p className="text-xs text-muted-foreground">
              A passive trend of names guests mention in reviews. Not a performance metric: never use it for quotas, rankings or
              to ask staff to collect reviews.
            </p>
            {data.staffMentions.length === 0 ? <p className="text-sm text-muted-foreground">No team names mentioned.</p> : (
              <p className="text-sm">{data.staffMentions.map((s) => `${s.name} (${s.mentions})`).join(' · ')}</p>
            )}
          </CardContent></Card>

          <p className="text-xs text-muted-foreground">{METHOD[data.analysis.method]} · {data.analysis.analyzed} reviews analysed.</p>
        </>
      )}
    </div>
  );
}
