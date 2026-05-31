'use client';
/**
 * Restaurant-admin Happy Hours dashboard — client surface.
 *
 *   <HappyHoursClient />
 *     – KPI strip: Active / Upcoming / Expired counts + real this-week savings
 *       (summed server-side from `happyhour.applied` audit rows since Monday)
 *     – Tabs: Active / Upcoming / Expired / All
 *     – Scope filter + search-by-name
 *     – Card list per rule with scope/discount/schedule/validity summary
 *     – New rule button opens the editor
 */
import { useMemo, useState } from 'react';
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
  Plus, Sparkles, Search, Clock, Calendar, IndianRupee, Percent, Tag,
  TrendingUp, AlertCircle, Trash2, PencilLine
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { RuleEditor } from './rule-editor';

export type HappyHourScope = 'RESTAURANT' | 'CATEGORY' | 'MENU_ITEM' | 'COMBO';
export type HappyHourDiscountType = 'PERCENTAGE' | 'FIXED_PRICE' | 'FIXED_AMOUNT_OFF';

export type ScheduleRow = { dayOfWeek: number; startMin: number; endMin: number };

export type Rule = {
  id: string;
  name: string;
  description: string | null;
  scope: HappyHourScope;
  categoryId: string | null;
  menuItemId: string | null;
  comboId: string | null;
  discountType: HappyHourDiscountType;
  percentOff: number | null;
  fixedPrice: string | number | null;
  amountOff: string | number | null;
  minPrice: string | number | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  priority: number;
  schedules: ScheduleRow[];
  lifecycle: 'active' | 'upcoming' | 'expired';
};

export type Category = { id: string; name: string; branchId: string };
export type MenuItem = { id: string; name: string; branchId: string; categoryId: string; price: string | number };
export type Combo = { id: string; name: string; branchId: string; price: string | number };

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type TabKey = 'active' | 'upcoming' | 'expired' | 'all';

export function HappyHoursClient({
  rules, categories, menuItems, combos, counts, savingsThisWeek = 0
}: {
  rules: Rule[];
  categories: Category[];
  menuItems: MenuItem[];
  combos: Combo[];
  counts: { active: number; upcoming: number; expired: number };
  savingsThisWeek?: number;
}) {
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [tab, setTab] = useState<TabKey>('active');
  const [scopeFilter, setScopeFilter] = useState<'all' | HappyHourScope>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return rules.filter((r) => {
      if (tab !== 'all' && r.lifecycle !== tab) return false;
      if (scopeFilter !== 'all' && r.scope !== scopeFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [r.name, r.description ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rules, tab, scopeFilter, search]);

  const empty = rules.length === 0;

  function startWeekdayPreset() {
    setEditing({
      name: 'Weekday Happy Hour',
      scope: 'RESTAURANT',
      discountType: 'PERCENTAGE',
      percentOff: 20,
      schedules: [1, 2, 3, 4, 5].map((d) => ({
        dayOfWeek: d, startMin: 17 * 60, endMin: 20 * 60
      })),
      isActive: true,
      priority: 0
    });
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Sparkles} label="Active" value={String(counts.active)} hint="Currently running" tone="success" />
        <Kpi icon={Clock} label="Upcoming" value={String(counts.upcoming)} hint="Starts in the future" />
        <Kpi icon={AlertCircle} label="Expired" value={String(counts.expired)} hint="Ended or turned off" tone="muted" />
        <Kpi icon={TrendingUp} label="Savings this week" value={money(savingsThisWeek)} hint="Passed to customers since Monday" tone="success" />
      </div>

      {/* Empty hero */}
      {empty && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-card">
          <CardContent className="p-6 flex items-start gap-4">
            <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary shrink-0">
              <Clock className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">No happy hours yet — try Weekday Happy Hour as a starter</div>
              <p className="text-sm text-muted-foreground mt-1">
                Happy Hour rules rewrite the displayed unit price during specific
                time windows. Set up a flat 20% off Mon–Fri 5–8pm in one click, or
                build a custom schedule from scratch.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setEditing({ scope: 'RESTAURANT', discountType: 'PERCENTAGE' })}>
                  <Plus className="size-4" /> New rule
                </Button>
                <Button variant="outline" onClick={startWeekdayPreset}>
                  <Sparkles className="size-4" /> Start with Weekday Happy Hour
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
              <Chip active={tab === 'all'}      onClick={() => setTab('all')}>All ({rules.length})</Chip>
            </div>
            <div className="w-44">
              <Select value={scopeFilter} onValueChange={(v: any) => setScopeFilter(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All scopes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scopes</SelectItem>
                  <SelectItem value="RESTAURANT">Restaurant</SelectItem>
                  <SelectItem value="CATEGORY">Category</SelectItem>
                  <SelectItem value="MENU_ITEM">Menu item</SelectItem>
                  <SelectItem value="COMBO">Combo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[180px] max-w-sm">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9"
                placeholder="Search by name or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ml-auto">
              <Button onClick={() => setEditing({ scope: 'RESTAURANT', discountType: 'PERCENTAGE' })}>
                <Plus className="size-4" /> New rule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Card list */}
      {!empty && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          title="No rules match the current filter"
          description="Try a different scope or clear the search."
        />
      )}

      {!empty && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              categories={categories}
              menuItems={menuItems}
              combos={combos}
              onEdit={() => setEditing(r)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing}
          categories={categories}
          menuItems={menuItems}
          combos={combos}
          onClose={() => setEditing(null)}
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

function RuleCard({
  rule, categories, menuItems, combos, onEdit
}: {
  rule: Rule;
  categories: Category[];
  menuItems: MenuItem[];
  combos: Combo[];
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const dim = rule.lifecycle === 'expired' || !rule.isActive;

  async function deactivate() {
    if (!confirm(`Deactivate "${rule.name}"? The rule stops applying immediately. Past orders are unaffected.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/happy-hours/${rule.id}`, { method: 'DELETE' });
      if (!r.ok) {
        await reportApiError(r, 'Could not deactivate rule');
        return;
      }
      toast.success('Rule deactivated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={dim ? 'opacity-70' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold truncate">{rule.name}</h3>
              <LifecycleBadge lifecycle={rule.lifecycle} />
              {rule.priority !== 0 && (
                <Badge variant="muted" className="text-[10px]">Priority {rule.priority}</Badge>
              )}
            </div>
            {rule.description && (
              <p className="text-xs text-muted-foreground truncate">{rule.description}</p>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <Detail label="Scope" value={scopeSummary(rule, categories, menuItems, combos)} icon={Tag} />
              <Detail label="Discount" value={discountSummary(rule)} icon={rule.discountType === 'PERCENTAGE' ? Percent : IndianRupee} />
              <Detail label="Schedule" value={scheduleSummary(rule.schedules)} icon={Clock} />
              <Detail
                label="Validity"
                value={
                  fmtDate(rule.validFrom, { dateStyle: 'medium' }) +
                  (rule.validTo ? ' → ' + fmtDate(rule.validTo, { dateStyle: 'medium' }) : ' → no end')
                }
                icon={Calendar}
              />
            </dl>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilLine className="size-3.5" /> Edit
            </Button>
            {rule.isActive && (
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

function LifecycleBadge({ lifecycle }: { lifecycle: Rule['lifecycle'] }) {
  if (lifecycle === 'active')   return <Badge variant="success" className="text-[10px]">Active</Badge>;
  if (lifecycle === 'upcoming') return <Badge variant="warning" className="text-[10px]">Upcoming</Badge>;
  return <Badge variant="muted" className="text-[10px]">Expired</Badge>;
}

// ─── Summary helpers ───────────────────────────────────────────────────────

function scopeSummary(r: Rule, categories: Category[], menuItems: MenuItem[], combos: Combo[]): string {
  switch (r.scope) {
    case 'RESTAURANT': return 'All restaurant';
    case 'CATEGORY': {
      const c = categories.find((x) => x.id === r.categoryId);
      return c ? `Category: ${c.name}` : 'Category';
    }
    case 'MENU_ITEM': {
      const m = menuItems.find((x) => x.id === r.menuItemId);
      return m ? `Item: ${m.name}` : 'Menu item';
    }
    case 'COMBO': {
      const c = combos.find((x) => x.id === r.comboId);
      return c ? `Combo: ${c.name}` : 'Combo';
    }
  }
}

function discountSummary(r: Rule): string {
  const floor = r.minPrice != null && Number(r.minPrice) > 0 ? `, floor ${money(Number(r.minPrice))}` : '';
  switch (r.discountType) {
    case 'PERCENTAGE':       return `${Number(r.percentOff ?? 0)}% off${floor}`;
    case 'FIXED_PRICE':      return `Fixed ${money(Number(r.fixedPrice ?? 0))}`;
    case 'FIXED_AMOUNT_OFF': return `${money(Number(r.amountOff ?? 0))} off${floor}`;
  }
}

/**
 * Compact schedule summary. Groups identical (startMin, endMin) windows into
 * consecutive-day ranges, e.g. "Mon–Fri 17:00–20:00, Sat 12:00–15:00".
 */
export function scheduleSummary(rows: ScheduleRow[]): string {
  if (!rows || rows.length === 0) return '24/7 (no schedule)';
  // group by window key
  const byWindow = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.startMin}-${r.endMin}`;
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key)!.push(r.dayOfWeek);
  }
  const parts: string[] = [];
  for (const [key, days] of byWindow.entries()) {
    const [s, e] = key.split('-').map(Number);
    days.sort((a, b) => a - b);
    parts.push(`${compressDays(days)} ${mToTime(s)}–${mToTime(e)}`);
  }
  return parts.join(', ');
}

function compressDays(days: number[]): string {
  if (days.length === 7) return 'Every day';
  // Build consecutive ranges over JS day numbering (0=Sun..6=Sat). Treat as
  // straightforward intervals — Sun is its own run unless adjacent to Sat.
  const runs: [number, number][] = [];
  let start = days[0];
  let prev = days[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i] === prev + 1) {
      prev = days[i];
    } else {
      runs.push([start, prev]);
      start = days[i];
      prev = days[i];
    }
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => a === b ? DAY_SHORT[a] : `${DAY_SHORT[a]}–${DAY_SHORT[b]}`).join(', ');
}

function mToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
