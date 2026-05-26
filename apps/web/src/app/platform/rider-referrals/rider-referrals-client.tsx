'use client';
/**
 * Rider referrals read view. Referrals are grouped into collapsible status
 * sections, each with a count + total bonus subtotal. No mutations.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { money } from '@/lib/utils';
import { Gift, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export type ReferralStatus = 'PENDING' | 'SIGNED_UP' | 'QUALIFIED' | 'REWARDED';

export interface ReferralRow {
  id: string;
  referrerId: string;
  code: string;
  refereePhone: string | null;
  refereeName: string | null;
  status: ReferralStatus;
  bonusAmount: number;
  createdAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  referrer: { name: string | null; phone: string | null };
}

const STATUS_ORDER: ReferralStatus[] = ['REWARDED', 'QUALIFIED', 'SIGNED_UP', 'PENDING'];

// The next rung up for each status, plus the action label. REWARDED is terminal.
const NEXT_STEP: Record<ReferralStatus, { next: ReferralStatus; label: string } | null> = {
  PENDING:   { next: 'SIGNED_UP', label: 'Mark signed up' },
  SIGNED_UP: { next: 'QUALIFIED', label: 'Mark qualified' },
  QUALIFIED: { next: 'REWARDED',  label: 'Reward & pay bonus' },
  REWARDED:  null
};

const STATUS_META: Record<ReferralStatus, { label: string; variant: 'success' | 'default' | 'warning' | 'muted' }> = {
  REWARDED:  { label: 'Rewarded',  variant: 'success' },
  QUALIFIED: { label: 'Qualified', variant: 'default' },
  SIGNED_UP: { label: 'Signed up', variant: 'warning' },
  PENDING:   { label: 'Pending',   variant: 'muted' }
};

export function RiderReferralsClient({ rows }: { rows: ReferralRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function advance(r: ReferralRow) {
    const step = NEXT_STEP[r.status];
    if (!step) return;
    if (step.next === 'REWARDED') {
      const ok = window.confirm(
        `Reward this referral and credit ${money(r.bonusAmount)} to ${r.referrer.name ?? 'the referrer'}'s earnings? This pays out the bonus and cannot be undone.`
      );
      if (!ok) return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/platform/rider-referrals/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: step.next })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.message || `Failed: ${await res.text().catch(() => 'error')}`);
        return;
      }
      const j = await res.json();
      toast.success(j.bonusCredited > 0 ? `Rewarded — ${money(j.bonusCredited)} credited` : `Marked ${step.next.toLowerCase().replace('_', ' ')}`);
      router.refresh();
    } catch {
      toast.error('Failed to update referral');
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo(() => {
    return STATUS_ORDER.map((status) => {
      const items = rows.filter((r) => r.status === status);
      const totalBonus = items.reduce((sum, r) => sum + r.bonusAmount, 0);
      return { status, items, totalBonus };
    }).filter((g) => g.items.length > 0);
  }, [rows]);

  if (rows.length === 0) {
    return <EmptyState icon={Gift} title="No referrals yet" description="Rider referrals will appear here as riders share their codes." />;
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const meta = STATUS_META[g.status];
        return (
          <section key={g.status}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Badge variant={meta.variant} className="text-[10px]">{meta.label}</Badge>
                <span className="text-sm text-muted-foreground">
                  {g.items.length} referral{g.items.length === 1 ? '' : 's'}
                </span>
              </h3>
              <span className="text-xs text-muted-foreground">
                Total bonus: <strong className="text-foreground">{money(g.totalBonus)}</strong>
              </span>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <Th>Referrer</Th>
                        <Th>Code</Th>
                        <Th>Referee</Th>
                        <Th align="right">Bonus</Th>
                        <Th>Created</Th>
                        <Th>Qualified</Th>
                        <Th>Rewarded</Th>
                        <Th align="right">Action</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {g.items.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <div className="font-medium text-xs truncate max-w-[160px]">{r.referrer.name ?? '—'}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{r.referrer.phone}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                          <td className="px-4 py-3">
                            <div className="text-xs truncate max-w-[150px]">{r.refereeName ?? '—'}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{r.refereePhone ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.bonusAmount)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(r.createdAt)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{r.qualifiedAt ? fmt(r.qualifiedAt) : '—'}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{r.rewardedAt ? fmt(r.rewardedAt) : '—'}</td>
                          <td className="px-4 py-3 text-right">
                            {NEXT_STEP[r.status] ? (
                              <Button
                                size="sm"
                                variant={NEXT_STEP[r.status]!.next === 'REWARDED' ? 'default' : 'outline'}
                                disabled={busyId === r.id}
                                onClick={() => advance(r)}
                              >
                                {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                                {NEXT_STEP[r.status]!.label}
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Paid</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}
