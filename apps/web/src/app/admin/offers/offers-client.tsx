'use client';
/**
 * Restaurant-admin offers management surface.
 *
 *   <OffersClient />
 *     – 4 KPI tiles up top (active / auto-apply / redemptions this month / top performer)
 *     – filter chips + type filter + search box
 *     – a sortable table of all offers for this restaurant
 *     – row click opens the editor dialog (in edit mode)
 *     – soft-delete via DELETE; isActive toggle via PATCH
 *     – `New offer` button opens an empty editor
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Plus, Sparkles, Search, Percent, IndianRupee, Tag, Zap, Layers, TrendingUp,
  CalendarClock, Users, Repeat, Gift, Store, Globe
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { OfferEditor } from './offer-editor';

export type OfferType =
  | 'PERCENTAGE'
  | 'FIXED'
  | 'BUY_X_GET_Y'
  | 'COMBO_DISCOUNT'
  | 'FREE_ITEM_ABOVE'
  | 'FIRST_ORDER'
  | 'REPEAT_CUSTOMER'
  | 'DINE_IN_TO_ONLINE'
  | 'ONLINE_TO_DINE_IN';

export type ChannelScope = 'ANY' | 'ONLINE' | 'DINE_IN';

export type Offer = {
  id: string;
  name: string;
  description: string | null;
  type: OfferType;
  code: string | null;
  percentOff: number | null;
  flatOff: string | number | null;
  maxDiscount: string | number | null;
  minOrderAmount: string | number | null;
  rewardConfig: any;
  restaurantId: string | null;
  branchId: string | null;
  issuedChannel: ChannelScope;
  redeemChannel: ChannelScope;
  minCustomerOrders: number;
  validFrom: string;
  validTo: string | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
  priority: number;
  autoApply: boolean;
  stackable: boolean;
  imageUrl: string | null;
  fulfillmentScope: FulfillmentType[];
  schedules: OfferSchedule[];
  createdAt: string;
  appliesToCategories: { categoryId: string }[];
  appliesToItems: { menuItemId: string }[];
  _count?: { redemptions: number };
};

export type FulfillmentType = 'DELIVERY' | 'PICKUP' | 'DINE_IN';
export type OfferSchedule = { dayOfWeek: number; startMin: number; endMin: number };

export type Branch = { id: string; name: string; isActive: boolean };
export type Category = { id: string; name: string; branchId: string };
export type MenuItem = {
  id: string;
  name: string;
  branchId: string;
  categoryId: string;
  price: string | number;
  isAvailable: boolean;
};

export const OFFER_TYPE_META: Record<OfferType, { label: string; tone: 'default' | 'success' | 'warning' | 'secondary'; icon: any; hint: string }> = {
  PERCENTAGE:        { label: 'Percentage',        tone: 'default',   icon: Percent,       hint: 'X% off the eligible subtotal, optionally capped.' },
  FIXED:             { label: 'Flat off',          tone: 'default',   icon: IndianRupee,   hint: 'Subtract a fixed rupee amount from the cart.' },
  BUY_X_GET_Y:       { label: 'Buy X get Y',       tone: 'secondary', icon: Gift,          hint: 'Buy N of A → get M of B free or discounted.' },
  COMBO_DISCOUNT:    { label: 'Combo',             tone: 'secondary', icon: Layers,        hint: 'Bundle of items at a slashed combined price.' },
  FREE_ITEM_ABOVE:   { label: 'Free item',         tone: 'secondary', icon: Gift,          hint: 'Free menu item when cart subtotal hits a threshold.' },
  FIRST_ORDER:       { label: 'First order',       tone: 'success',   icon: Sparkles,      hint: "Redeemable only on a customer's very first order." },
  REPEAT_CUSTOMER:   { label: 'Repeat customer',   tone: 'success',   icon: Repeat,        hint: 'Unlocks after N completed orders by the customer.' },
  DINE_IN_TO_ONLINE: { label: 'Dine-in → Online',  tone: 'warning',   icon: Globe,         hint: 'Issued at a dine-in table, redeemable online.' },
  ONLINE_TO_DINE_IN: { label: 'Online → Dine-in',  tone: 'warning',   icon: Store,         hint: 'Issued online, redeemable in-restaurant.' }
};

export const OFFER_TYPE_ORDER: OfferType[] = [
  'PERCENTAGE', 'FIXED', 'BUY_X_GET_Y', 'COMBO_DISCOUNT', 'FREE_ITEM_ABOVE',
  'FIRST_ORDER', 'REPEAT_CUSTOMER', 'DINE_IN_TO_ONLINE', 'ONLINE_TO_DINE_IN'
];

type StatusFilter = 'all' | 'active' | 'inactive' | 'expired';

export function OffersClient({
  offers, branches, categories, menuItems, restaurantId, kpis
}: {
  offers: Offer[];
  branches: Branch[];
  categories: Category[];
  menuItems: MenuItem[];
  restaurantId: string;
  kpis: { redemptionsThisMonth: number; topPerformerName: string | null; topPerformerUsedCount: number };
}) {
  const [editing, setEditing] = useState<Partial<Offer> | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<OfferType | 'all'>('all');
  const [search, setSearch] = useState('');

  const now = Date.now();

  // Counts for KPI tiles
  const activeCount = offers.filter((o) => o.isActive && (!o.validTo || new Date(o.validTo).getTime() > now)).length;
  const autoApplyCount = offers.filter((o) => o.isActive && o.autoApply).length;

  const filtered = useMemo(() => {
    return offers.filter((o) => {
      const expired = o.validTo && new Date(o.validTo).getTime() < now;
      if (statusFilter === 'active'   && (!o.isActive || expired)) return false;
      if (statusFilter === 'inactive' && o.isActive) return false;
      if (statusFilter === 'expired'  && !expired) return false;
      if (typeFilter !== 'all' && o.type !== typeFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [o.name, o.description ?? '', o.code ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [offers, statusFilter, typeFilter, search, now]);

  const empty = offers.length === 0;

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Sparkles} label="Active offers" value={String(activeCount)} hint={`${offers.length} total`} />
        <Kpi icon={Zap} label="Auto-apply" value={String(autoApplyCount)} hint="No code needed" />
        <Kpi icon={CalendarClock} label="Redemptions this month" value={String(kpis.redemptionsThisMonth)} hint="Across all offers" />
        <Kpi
          icon={TrendingUp}
          label="Top performer"
          value={kpis.topPerformerName ?? '—'}
          hint={kpis.topPerformerName ? `${kpis.topPerformerUsedCount} uses` : 'No usage yet'}
          mono={false}
        />
      </div>

      {/* Empty hero */}
      {empty && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-card">
          <CardContent className="p-6 flex items-start gap-4">
            <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary shrink-0">
              <Sparkles className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">No offers yet — try Percentage discount for your first campaign</div>
              <p className="text-sm text-muted-foreground mt-1">
                The offers engine supports 9 promotion types from flat ₹ off to "buy-X-get-Y" and dine-in ↔ online incentives. Pick a type, set a reward, and decide whether it auto-applies or needs a code.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setEditing({ type: 'PERCENTAGE' })}>
                  <Plus className="size-4" /> New offer
                </Button>
                <Button variant="outline" onClick={() => setEditing({ type: 'FIRST_ORDER' })}>
                  <Sparkles className="size-4" /> Start with first-order
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + search */}
      {!empty && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={statusFilter === 'all'}      onClick={() => setStatusFilter('all')}>All</Chip>
            <Chip active={statusFilter === 'active'}   onClick={() => setStatusFilter('active')}>Active</Chip>
            <Chip active={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')}>Inactive</Chip>
            <Chip active={statusFilter === 'expired'}  onClick={() => setStatusFilter('expired')}>Expired</Chip>
          </div>
          <div className="w-48">
            <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {OFFER_TYPE_ORDER.map((t) => (
                  <SelectItem key={t} value={t}>{OFFER_TYPE_META[t].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[180px] max-w-sm">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9"
              placeholder="Search by name, code, description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ml-auto">
            <Button onClick={() => setEditing({ type: 'PERCENTAGE' })}>
              <Plus className="size-4" /> New offer
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {!empty && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Offer</Th>
                    <Th>Type</Th>
                    <Th>Reward</Th>
                    <Th>Scope</Th>
                    <Th>Validity</Th>
                    <Th align="right">Usage</Th>
                    <Th align="center">Active</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-muted-foreground">
                        No offers match the current filter.
                      </td>
                    </tr>
                  )}
                  {filtered.map((o) => {
                    const meta = OFFER_TYPE_META[o.type];
                    const Icon = meta.icon;
                    const expired = o.validTo && new Date(o.validTo).getTime() < now;
                    const dim = expired || !o.isActive;
                    const scope = scopeSummary(o, branches, categories, menuItems);
                    return (
                      <tr
                        key={o.id}
                        className={`hover:bg-muted/30 cursor-pointer ${dim ? 'opacity-55' : ''}`}
                        onClick={() => setEditing(o)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{o.name}</span>
                            {o.autoApply && <Badge variant="success" className="text-[10px] shrink-0">Auto</Badge>}
                            {o.stackable && <Badge variant="secondary" className="text-[10px] shrink-0">Stackable</Badge>}
                            {expired && <Badge variant="muted" className="text-[10px] shrink-0">Expired</Badge>}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            {o.code ? (
                              <span className="inline-flex items-center gap-1"><Tag className="size-3" /><span className="font-mono">{o.code}</span></span>
                            ) : (
                              <span className="italic">No code</span>
                            )}
                            <span>·</span>
                            <span>Priority {o.priority}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge variant={meta.tone} className="gap-1">
                            <Icon className="size-3" /> {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                          {rewardSummary(o)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{scope}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(o.validFrom, { dateStyle: 'medium' })}
                          {o.validTo ? <> → {fmtDate(o.validTo, { dateStyle: 'medium' })}</> : ' → no end'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs">
                          {o.usedCount}/{o.usageLimit ?? '∞'}
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <ToggleActive id={o.id} initial={o.isActive} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!empty && filtered.length === 0 && search.trim() && (
        <EmptyState
          icon={Search}
          title="No matching offers"
          description="Try a different keyword or clear the filters."
        />
      )}

      {editing && (
        <OfferEditor
          offer={editing}
          branches={branches}
          categories={categories}
          menuItems={menuItems}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Small components ────────────────────────────────────────────────────────

function Kpi({
  icon: Icon, label, value, hint, mono = true
}: { icon: any; label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold leading-tight ${mono ? 'tabular-nums' : ''} truncate`}>{value}</div>
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

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return <th className={`${alignCls} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function ToggleActive({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return (
    <Switch
      checked={v}
      onCheckedChange={async (next) => {
        setV(!!next);
        const r = await fetch(`/api/admin/offers/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !!next })
        });
        if (!r.ok) {
          setV(!next);
          const { toast } = await import('sonner');
          toast.error('Failed to update');
          return;
        }
        router.refresh();
      }}
    />
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rewardSummary(o: Offer): React.ReactNode {
  switch (o.type) {
    case 'PERCENTAGE': {
      const pct = o.percentOff ?? 0;
      const cap = o.maxDiscount ? ` (max ${money(Number(o.maxDiscount))})` : '';
      return <span className="inline-flex items-center gap-1"><Percent className="size-3" />{pct}%{cap}</span>;
    }
    case 'FIXED':
      return <span className="inline-flex items-center gap-1"><IndianRupee className="size-3" />{Number(o.flatOff ?? 0).toFixed(0)} off</span>;
    case 'FIRST_ORDER':
    case 'REPEAT_CUSTOMER':
    case 'DINE_IN_TO_ONLINE':
    case 'ONLINE_TO_DINE_IN': {
      if (o.flatOff) return <span className="inline-flex items-center gap-1"><IndianRupee className="size-3" />{Number(o.flatOff).toFixed(0)} off</span>;
      if (o.percentOff) {
        const cap = o.maxDiscount ? ` (max ${money(Number(o.maxDiscount))})` : '';
        return <span className="inline-flex items-center gap-1"><Percent className="size-3" />{o.percentOff}%{cap}</span>;
      }
      return <span className="text-muted-foreground">—</span>;
    }
    case 'BUY_X_GET_Y': {
      const cfg = o.rewardConfig ?? {};
      const dt = cfg.getDiscountType ?? 'PERCENT';
      const val = Number(cfg.getDiscountValue ?? cfg.getDiscountPct ?? 100);
      const reward =
        dt === 'PERCENT' ? (val >= 100 ? 'free' : `@ ${val}% off`)
        : dt === 'FIXED' ? `@ ${money(val)} off`
        : `@ ${money(val)}`;
      return <span>Buy {cfg.buyQty ?? 1} get {cfg.getQty ?? 1} {reward}</span>;
    }
    case 'COMBO_DISCOUNT': {
      const cfg = o.rewardConfig ?? {};
      const n = Array.isArray(cfg.items) ? cfg.items.length : 0;
      return <span>{n}-item combo · {money(Number(cfg.comboPrice ?? 0))}</span>;
    }
    case 'FREE_ITEM_ABOVE': {
      const cfg = o.rewardConfig ?? {};
      return <span>Free item over {money(Number(cfg.threshold ?? 0))}</span>;
    }
    default:
      return <span>—</span>;
  }
}

function scopeSummary(o: Offer, branches: Branch[], categories: Category[], menuItems: MenuItem[]): string {
  const parts: string[] = [];
  if (o.branchId) {
    const b = branches.find((x) => x.id === o.branchId);
    parts.push(b ? b.name : 'Single branch');
  } else {
    parts.push('All branches');
  }
  const catCount = o.appliesToCategories?.length ?? 0;
  const itemCount = o.appliesToItems?.length ?? 0;
  if (catCount === 0 && itemCount === 0) {
    parts.push('whole menu');
  } else {
    if (catCount) parts.push(`${catCount} ${catCount === 1 ? 'category' : 'categories'}`);
    if (itemCount) parts.push(`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`);
  }
  return parts.join(' · ');
}
