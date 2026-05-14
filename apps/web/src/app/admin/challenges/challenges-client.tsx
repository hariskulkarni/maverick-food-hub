'use client';
/**
 * Platform-admin Challenges dashboard — client surface.
 *
 *   <ChallengesClient />
 *     – KPI strip: Active count / Total participants / Rewards this month /
 *       Completion rate
 *     – Tabs: Active / Upcoming / Expired / All
 *     – Type filter
 *     – Per-challenge card with: name, type chip, target, window chip, reward
 *       summary, issued/limit progress bar, "Observe" + "Edit" actions
 *     – "Observe" opens a side drawer that fetches /[id]/progress on demand
 *     – "New challenge" opens the ChallengeEditor dialog
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Plus, Trophy, Search, Trash2, PencilLine, Users, TrendingUp, Gift,
  Eye, Target, Clock, AlertCircle, Award
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { toast } from 'sonner';
import { ChallengeEditor } from './challenge-editor';

export type ChallengeType = 'ORDER_COUNT' | 'SPEND_THRESHOLD' | 'CUISINE_VARIETY' | 'WEEKEND_STREAK' | 'FIRST_N_ORDERS';
export type ChallengeWindow = 'LIFETIME' | 'MONTHLY' | 'WEEKLY' | 'CUSTOM';
export type ChallengeRewardType = 'FIXED_OFF' | 'PERCENT_OFF' | 'FREE_DELIVERY';

export type Challenge = {
  id: string;
  name: string;
  description: string | null;
  type: ChallengeType;
  target: number;
  window: ChallengeWindow;
  minOrderValue: string | number | null;
  rewardType: ChallengeRewardType;
  rewardValue: string | number;
  rewardMaxDiscount: string | number | null;
  rewardValidityDays: number;
  validFrom: string;
  validTo: string | null;
  priority: number;
  isActive: boolean;
  perCustomerLimit: number;
  phoneVerifiedOnly: boolean;
  totalLimit: number | null;
  totalIssued: number;
  brandId: string | null;
  restaurantId: string | null;
  lifecycle: 'active' | 'upcoming' | 'expired';
  counters: {
    totalIssued: number;
    completedCount: number;
    participantCount: number;
  };
};

type TabKey = 'active' | 'upcoming' | 'expired' | 'all';

export const TYPE_LABEL: Record<ChallengeType, string> = {
  ORDER_COUNT: 'Order count',
  SPEND_THRESHOLD: 'Spend threshold',
  CUISINE_VARIETY: 'Cuisine variety',
  WEEKEND_STREAK: 'Weekend streak',
  FIRST_N_ORDERS: 'First N orders'
};

export const WINDOW_LABEL: Record<ChallengeWindow, string> = {
  LIFETIME: 'Lifetime',
  MONTHLY: 'Monthly',
  WEEKLY: 'Weekly',
  CUSTOM: 'Custom range'
};

export function ChallengesClient({
  challenges, rewardsThisMonth
}: {
  challenges: Challenge[];
  rewardsThisMonth: number;
}) {
  const [editing, setEditing] = useState<Partial<Challenge> | null>(null);
  const [observing, setObserving] = useState<Challenge | null>(null);
  const [tab, setTab] = useState<TabKey>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | ChallengeType>('all');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => ({
    active: challenges.filter((c) => c.lifecycle === 'active').length,
    upcoming: challenges.filter((c) => c.lifecycle === 'upcoming').length,
    expired: challenges.filter((c) => c.lifecycle === 'expired').length
  }), [challenges]);

  const totalParticipants = useMemo(
    () => challenges.reduce((s, c) => s + c.counters.participantCount, 0),
    [challenges]
  );
  const totalCompleted = useMemo(
    () => challenges.reduce((s, c) => s + c.counters.completedCount, 0),
    [challenges]
  );
  const completionRate = totalParticipants > 0 ? Math.round((totalCompleted / totalParticipants) * 100) : 0;

  const filtered = useMemo(() => {
    return challenges.filter((c) => {
      if (tab !== 'all' && c.lifecycle !== tab) return false;
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [c.name, c.description ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [challenges, tab, typeFilter, search]);

  const empty = challenges.length === 0;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Trophy}     label="Active" value={String(counts.active)} hint="Currently running" tone="success" />
        <Kpi icon={Users}      label="Total participants" value={String(totalParticipants)} hint="Customers in progress" />
        <Kpi icon={Gift}       label="Rewards this month" value={String(rewardsThisMonth)} hint="Issued since the 1st" />
        <Kpi icon={TrendingUp} label="Completion rate" value={`${completionRate}%`} hint="Completed ÷ started" />
      </div>

      {/* Empty hero */}
      {empty && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-card">
          <CardContent className="p-6 flex items-start gap-4">
            <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary shrink-0">
              <Trophy className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">No challenges yet</div>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first gamified challenge. Customers who hit the target
                get a unique coupon code auto-minted from the Offer engine.
              </p>
              <div className="mt-3">
                <Button onClick={() => setEditing({ type: 'ORDER_COUNT', window: 'LIFETIME', rewardType: 'FIXED_OFF' })}>
                  <Plus className="size-4" /> New challenge
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs + filters */}
      {!empty && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Chip active={tab === 'active'}   onClick={() => setTab('active')}>Active ({counts.active})</Chip>
              <Chip active={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming ({counts.upcoming})</Chip>
              <Chip active={tab === 'expired'}  onClick={() => setTab('expired')}>Expired ({counts.expired})</Chip>
              <Chip active={tab === 'all'}      onClick={() => setTab('all')}>All ({challenges.length})</Chip>
            </div>
            <div className="w-52">
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="ORDER_COUNT">{TYPE_LABEL.ORDER_COUNT}</SelectItem>
                  <SelectItem value="SPEND_THRESHOLD">{TYPE_LABEL.SPEND_THRESHOLD}</SelectItem>
                  <SelectItem value="CUISINE_VARIETY">{TYPE_LABEL.CUISINE_VARIETY}</SelectItem>
                  <SelectItem value="WEEKEND_STREAK">{TYPE_LABEL.WEEKEND_STREAK}</SelectItem>
                  <SelectItem value="FIRST_N_ORDERS">{TYPE_LABEL.FIRST_N_ORDERS}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9"
                placeholder="Search by name or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ml-auto">
              <Button onClick={() => setEditing({ type: 'ORDER_COUNT', window: 'LIFETIME', rewardType: 'FIXED_OFF' })}>
                <Plus className="size-4" /> New challenge
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Card list */}
      {!empty && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          title="No challenges match the current filter"
          description="Try a different type, lifecycle tab, or clear the search."
        />
      )}

      {!empty && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              onEdit={() => setEditing(c)}
              onObserve={() => setObserving(c)}
            />
          ))}
        </div>
      )}

      {editing && (
        <ChallengeEditor
          challenge={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {observing && (
        <ObserveDrawer
          challenge={observing}
          onClose={() => setObserving(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Kpi({
  icon: Icon, label, value, hint, tone
}: { icon: any; label: string; value: string; hint?: string; tone?: 'success' | 'muted' }) {
  const accent =
    tone === 'success' ? 'text-success' :
    tone === 'muted'   ? 'text-muted-foreground' :
    'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold leading-tight tabular-nums ${accent}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}

function ChallengeCard({
  challenge, onEdit, onObserve
}: {
  challenge: Challenge;
  onEdit: () => void;
  onObserve: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const dim = challenge.lifecycle === 'expired' || !challenge.isActive;

  async function deactivate() {
    if (!confirm(`Deactivate "${challenge.name}"? Customers stop earning new rewards immediately. Already-issued coupons remain valid.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/challenges/${challenge.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('Challenge deactivated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const issued = challenge.counters.totalIssued;
  const limit = challenge.totalLimit ?? null;
  const issuedPct = limit ? Math.min(100, Math.round((issued / Math.max(1, limit)) * 100)) : null;

  return (
    <Card className={dim ? 'opacity-70' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold truncate">{challenge.name}</h3>
              <LifecycleBadge lifecycle={challenge.lifecycle} />
              <Badge variant="muted" className="text-[10px]">{TYPE_LABEL[challenge.type]}</Badge>
              <Badge variant="muted" className="text-[10px]">{WINDOW_LABEL[challenge.window]}</Badge>
              {challenge.priority !== 0 && (
                <Badge variant="muted" className="text-[10px]">Priority {challenge.priority}</Badge>
              )}
            </div>
            {challenge.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{challenge.description}</p>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <Detail label="Target" value={targetSummary(challenge)} icon={Target} />
              <Detail label="Reward" value={rewardSummary(challenge)} icon={Gift} />
              <Detail label="Participants" value={`${challenge.counters.participantCount} in progress · ${challenge.counters.completedCount} completed`} icon={Users} />
              <Detail
                label="Validity"
                value={
                  fmtDate(challenge.validFrom, { dateStyle: 'medium' }) +
                  (challenge.validTo ? ' → ' + fmtDate(challenge.validTo, { dateStyle: 'medium' }) : ' → no end')
                }
                icon={Clock}
              />
            </dl>

            {/* Issued / limit progress bar */}
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Issued</span>
                <span className="tabular-nums">
                  {issued}{limit ? ` / ${limit}` : ' (no cap)'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: limit ? `${issuedPct}%` : (issued > 0 ? '100%' : '0%') }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={onObserve}>
              <Eye className="size-3.5" /> Observe
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilLine className="size-3.5" /> Edit
            </Button>
            {challenge.isActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={deactivate}
                disabled={busy}
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" /> Deactivate
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <Icon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="truncate text-foreground">{value}</dd>
      </div>
    </div>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: Challenge['lifecycle'] }) {
  if (lifecycle === 'active')   return <Badge variant="success" className="text-[10px]">Active</Badge>;
  if (lifecycle === 'upcoming') return <Badge variant="warning" className="text-[10px]">Upcoming</Badge>;
  return <Badge variant="muted" className="text-[10px]">Expired</Badge>;
}

// ─── Summary helpers ───────────────────────────────────────────────────────

export function targetSummary(c: Challenge): string {
  switch (c.type) {
    case 'ORDER_COUNT':     return `${c.target} delivered orders`;
    case 'SPEND_THRESHOLD': return `${money(c.target)} spent`;
    case 'CUISINE_VARIETY': return `${c.target} distinct cuisines`;
    case 'WEEKEND_STREAK':  return `${c.target} consecutive weekends`;
    case 'FIRST_N_ORDERS':  return `First ${c.target} orders`;
  }
}

export function rewardSummary(c: Challenge): string {
  const days = `, valid ${c.rewardValidityDays}d`;
  switch (c.rewardType) {
    case 'FIXED_OFF':     return `${money(Number(c.rewardValue))} off${days}`;
    case 'PERCENT_OFF':   {
      const cap = c.rewardMaxDiscount ? `, max ${money(Number(c.rewardMaxDiscount))}` : '';
      return `${Number(c.rewardValue)}% off${cap}${days}`;
    }
    case 'FREE_DELIVERY': return `Free delivery${days}`;
  }
}

// ─── Observe drawer (overlay dialog) ───────────────────────────────────────

function ObserveDrawer({ challenge, onClose }: { challenge: Challenge; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/admin/challenges/${challenge.id}/progress`);
        if (!r.ok) {
          if (!cancelled) toast.error('Failed to load progress');
          return;
        }
        const j = await r.json();
        if (!cancelled) setRows(j.progress ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [challenge.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Observe · {challenge.name}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground -mt-2">
          Top 50 progress rows for this challenge, most-recently updated first.
        </div>

        {loading && (
          <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">
            Loading customer progress…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <EmptyState
            icon={Award}
            title="No one's started this challenge yet"
            description="As soon as a customer's delivered order matches the rule, a progress row appears here."
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Customer</th>
                  <th className="text-left p-2 font-medium">Progress</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/30">
                    <td className="p-2">
                      <div className="font-medium truncate">{r.userName ?? '—'}</div>
                      <div className="text-[10px] text-muted-foreground">{r.userPhone ?? r.userEmail ?? '—'}</div>
                    </td>
                    <td className="p-2 w-[180px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${r.completed ? 'bg-success' : 'bg-primary'} transition-all`}
                            style={{ width: `${r.percent}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-[11px]">{r.value}/{r.target}</span>
                      </div>
                    </td>
                    <td className="p-2">
                      {r.completed ? (
                        <Badge variant="success" className="text-[10px]">Completed</Badge>
                      ) : (
                        <Badge variant="muted" className="text-[10px]">In progress</Badge>
                      )}
                    </td>
                    <td className="p-2 tabular-nums text-muted-foreground">
                      {fmtDate(r.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
