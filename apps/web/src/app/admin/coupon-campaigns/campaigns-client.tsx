'use client';
/**
 * Coupon-campaigns admin manager.
 *
 *   <CampaignsClient />
 *     – 4 KPI tiles (active campaigns / redemptions this month / revenue this
 *       month / avg conversion rate).
 *     – Tabs: All / Active / Paused / Expired.
 *     – Filter by channel + search by name/codePrefix.
 *     – Card list — each card shows name, channel chip, code, discount summary,
 *       redeemed/limit counter, conversion-rate badge, View-QR + Reports CTAs.
 *     – "New campaign" button opens the editor dialog.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Plus, Search, Mail, QrCode, BarChart3, Sparkles, TrendingUp, IndianRupee, Target, Tag
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { CampaignEditor } from './campaign-editor';

export type CampaignChannel = 'DINE_IN_TO_ONLINE' | 'ONLINE_TO_DINE_IN';
export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type Lifecycle = 'active' | 'paused' | 'expired' | 'draft';

export type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  codePrefix: string;
  channel: CampaignChannel;
  discountType: 'PERCENTAGE' | 'FIXED' | string;
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  maxUses: number | null;
  perUserLimit: number;
  validFrom: string;
  expiresAt: string | null;
  distributedCount: number;
  status: CampaignStatus;
  lifecycle: Lifecycle;
  offer: {
    id: string;
    code: string | null;
    isActive: boolean;
    usageLimit: number | null;
    usedCount: number;
    redemptions: number;
  } | null;
  conversionRate: number;
};

type StatusFilter = 'all' | 'active' | 'paused' | 'expired';

export function CampaignsClient({
  campaigns,
  kpis
}: {
  campaigns: CampaignRow[];
  kpis: {
    activeCount: number;
    redemptionsThisMonth: number;
    revenueThisMonth: number;
    avgConversionRate: number;
  };
}) {
  const [editing, setEditing] = useState<Partial<CampaignRow> | 'new' | null>(null);
  const [tab, setTab] = useState<StatusFilter>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | CampaignChannel>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (tab !== 'all' && c.lifecycle !== tab) return false;
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [c.name, c.codePrefix, c.description ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, tab, channelFilter, search]);

  const empty = campaigns.length === 0;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          icon={Sparkles}
          label="Active campaigns"
          value={String(kpis.activeCount)}
          hint={`${campaigns.length} total`}
        />
        <Kpi
          icon={Mail}
          label="Redemptions this month"
          value={String(kpis.redemptionsThisMonth)}
          hint="Across all campaigns"
        />
        <Kpi
          icon={IndianRupee}
          label="Revenue this month"
          value={money(kpis.revenueThisMonth)}
          hint="From campaign-driven orders"
        />
        <Kpi
          icon={Target}
          label="Avg conversion"
          value={`${(kpis.avgConversionRate * 100).toFixed(1)}%`}
          hint="Redeemed / distributed"
        />
      </div>

      {/* Empty hero */}
      {empty && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-card">
          <CardContent className="p-6 flex items-start gap-4">
            <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary shrink-0">
              <Mail className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">No campaigns yet — try printing a 20% online code on dine-in receipts</div>
              <p className="text-sm text-muted-foreground mt-1">
                Coupon campaigns drive customers between channels. Print a code on a dine-in bill to bring them online, or email a QR after an online order so they walk in next time.
              </p>
              <div className="mt-3">
                <Button onClick={() => setEditing('new')}>
                  <Plus className="size-4" /> New campaign
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      {!empty && (
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
            <TabsList className="h-9">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="paused">Paused</TabsTrigger>
              <TabsTrigger value="expired">Expired</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="w-56">
            <Select value={channelFilter} onValueChange={(v: any) => setChannelFilter(v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="DINE_IN_TO_ONLINE">Dine-in → Online</SelectItem>
                <SelectItem value="ONLINE_TO_DINE_IN">Online → Dine-in</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* On phones, take the full row (other filter chips wrap to their
              own line). On sm+, share the row via flex-1 with a soft min so
              the search box doesn't get squashed by a long select. */}
          <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[180px] max-w-sm">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9"
              placeholder="Search by name or code prefix"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ml-auto">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New campaign
            </Button>
          </div>
        </div>
      )}

      {/* Card grid */}
      {!empty && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          title="No matching campaigns"
          description="Try a different keyword or change the filters."
        />
      )}
      {!empty && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((c) => (
            <CampaignCard key={c.id} c={c} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}

      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : (editing as CampaignRow)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────

function CampaignCard({ c, onEdit }: { c: CampaignRow; onEdit: () => void }) {
  const isDineToOnline = c.channel === 'DINE_IN_TO_ONLINE';
  const channelLabel = isDineToOnline ? 'Dine-in → Online' : 'Online → Dine-in';
  const channelEmoji = isDineToOnline ? '🍽️→📱' : '📱→🍽️';
  const redeemed = c.offer?.redemptions ?? 0;
  const limit = c.maxUses ?? null;
  const conversionPct = (c.conversionRate * 100).toFixed(1);
  const dim = c.lifecycle !== 'active';

  return (
    <Card className={dim ? 'opacity-70' : ''}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onEdit}
              className="text-left font-semibold hover:underline truncate block w-full"
            >
              {c.name}
            </button>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              <Badge variant={isDineToOnline ? 'warning' : 'secondary'} className="gap-1">
                <span aria-hidden>{channelEmoji}</span>
                <span>{channelLabel}</span>
              </Badge>
              <LifecycleBadge l={c.lifecycle} />
            </div>
            {c.description && (
              <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{c.description}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Code</div>
            <div className="font-mono font-semibold text-sm flex items-center gap-1">
              <Tag className="size-3" />
              {c.offer?.code ?? c.codePrefix}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Discount</div>
            <div className="text-sm font-medium">{discountSummary(c)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Redeemed</div>
            <div className="text-sm tabular-nums">
              {redeemed}
              <span className="text-muted-foreground"> / {limit ?? '∞'}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Conversion</div>
            <div className="text-sm tabular-nums flex items-center gap-1">
              <TrendingUp className="size-3 text-primary" />
              <span>{c.distributedCount > 0 ? `${conversionPct}%` : '—'}</span>
              {c.distributedCount === 0 && (
                <span className="text-[10px] text-muted-foreground">(no distribution)</span>
              )}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground">
          {fmtDate(c.validFrom, { dateStyle: 'medium' })}
          {c.expiresAt ? <> → {fmtDate(c.expiresAt, { dateStyle: 'medium' })}</> : ' → no end'}
          {' · '}
          {c.distributedCount.toLocaleString('en-IN')} distributed
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/coupon-campaigns/${c.id}/qr-poster`} target="_blank">
              <QrCode className="size-4" /> View QR
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/coupon-campaigns/${c.id}/reports`}>
              <BarChart3 className="size-4" /> Reports
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} className="ml-auto">
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LifecycleBadge({ l }: { l: Lifecycle }) {
  switch (l) {
    case 'active':
      return <Badge variant="success" className="text-[10px]">Active</Badge>;
    case 'paused':
      return <Badge variant="muted" className="text-[10px]">Paused</Badge>;
    case 'expired':
      return <Badge variant="muted" className="text-[10px]">Expired</Badge>;
    case 'draft':
    default:
      return <Badge variant="outline" className="text-[10px]">Draft</Badge>;
  }
}

function discountSummary(c: CampaignRow): string {
  if (c.discountType === 'PERCENTAGE') {
    const cap = c.maxDiscount ? ` (max ${money(c.maxDiscount)})` : '';
    return `${c.discountValue}% off${cap}`;
  }
  return `${money(c.discountValue)} off`;
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </div>
        <div className="mt-1 text-2xl font-semibold leading-tight tabular-nums truncate">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}
