'use client';
/**
 * Customer Rewards page — client surface. Two sections:
 *
 *   Active challenges
 *     One card per active challenge with title, description, friendly progress
 *     ("3 of 5 orders"), a progress bar, an estimated reward chip, and a tiny
 *     "How to qualify" tooltip explaining the rule.
 *
 *   Your rewards
 *     One card per ChallengeReward with the coupon code in monospace + copy
 *     button, the linked Offer's discount summary, an expiry pill, and a tiny
 *     "Use at checkout" hint. Rewards completed in the last 24h render with
 *     a `reveal` + `pulse-soft` glow.
 *
 * Empty state covers the case where neither array has anything.
 *
 * Visuals lean on saffron/warning gradients so the page feels celebratory.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Trophy, Gift, Copy, Check, Sparkles, Target, Clock, ChevronRight,
  Award, Info
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { toast } from 'sonner';

type ChallengeType = 'ORDER_COUNT' | 'SPEND_THRESHOLD' | 'CUISINE_VARIETY' | 'WEEKEND_STREAK' | 'FIRST_N_ORDERS';
type ChallengeWindow = 'LIFETIME' | 'MONTHLY' | 'WEEKLY' | 'CUSTOM';
type ChallengeRewardType = 'FIXED_OFF' | 'PERCENT_OFF' | 'FREE_DELIVERY';

type ChallengeRow = {
  id: string;
  name: string;
  description: string | null;
  type: ChallengeType;
  target: number;
  window: ChallengeWindow;
  rewardType: ChallengeRewardType;
  rewardValue: string | number;
  rewardMaxDiscount: string | number | null;
  rewardValidityDays: number;
  minOrderValue: string | number | null;
  progress: {
    value: number;
    percent: number;
    completed: boolean;
    completedAt: string | null;
  };
};

type RewardRow = {
  id: string;
  challengeId: string;
  issuedAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
  offer: {
    id: string;
    code: string;
    percentOff: number | null;
    flatOff: string | number | null;
    maxDiscount: string | number | null;
    validTo: string | null;
    type: string;
  };
  challenge: {
    id: string;
    name: string;
    description: string | null;
  };
};

export function RewardsClient({
  challenges, rewards
}: {
  challenges: ChallengeRow[];
  rewards: RewardRow[];
}) {
  const empty = challenges.length === 0 && rewards.length === 0;
  // Only show "in progress" challenges in the first section — completed ones
  // are represented by their reward in the second section.
  const activeChallenges = useMemo(() => challenges.filter((c) => !c.progress.completed), [challenges]);

  return (
    <div className="space-y-8">
      <header className="reveal">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-warning font-semibold">
          <Sparkles className="size-3.5" /> Earn as you order
        </div>
        <h1 className="display text-3xl font-semibold mt-1">My Rewards</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hit a milestone, unlock a coupon. Your in-progress challenges and earned rewards live here.
        </p>
      </header>

      {empty && (
        <EmptyState
          icon={Trophy}
          title="No active challenges or rewards yet"
          description="Check back after your next order — new challenges show up here as soon as you start qualifying."
          action={
            <Button asChild>
              <Link href="/">Browse restaurants</Link>
            </Button>
          }
        />
      )}

      {/* ── Active challenges ───────────────────────────────────────── */}
      {activeChallenges.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-primary" />
            <h2 className="font-semibold">Active challenges</h2>
            <Badge variant="muted" className="text-[10px]">{activeChallenges.length}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {activeChallenges.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        </section>
      )}

      {/* ── Your rewards ────────────────────────────────────────────── */}
      {rewards.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="size-4 text-warning" />
            <h2 className="font-semibold">Your rewards</h2>
            <Badge variant="success" className="text-[10px]">{rewards.length}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {rewards.map((r) => (
              <RewardCard key={r.id} reward={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Challenge card ────────────────────────────────────────────────────────

function ChallengeCard({ challenge }: { challenge: ChallengeRow }) {
  const [showHelp, setShowHelp] = useState(false);
  const percent = Math.max(2, Math.min(100, challenge.progress.percent));
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="font-semibold truncate">{challenge.name}</div>
            {challenge.description && (
              <div className="text-xs text-muted-foreground line-clamp-2">{challenge.description}</div>
            )}
          </div>
          <Badge variant="warning" className="text-[10px] shrink-0">
            <Gift className="size-3 mr-1" /> {estimatedReward(challenge)}
          </Badge>
        </div>

        {/* Friendly progress text + bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{friendlyProgress(challenge)}</span>
            <span className="tabular-nums font-medium">{percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-warning to-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* How to qualify */}
        <div>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showHelp}
          >
            <Info className="size-3" /> How to qualify
            <ChevronRight className={`size-3 transition-transform ${showHelp ? 'rotate-90' : ''}`} />
          </button>
          {showHelp && (
            <div className="mt-2 rounded-md border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              {qualifyText(challenge)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Reward card ───────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function RewardCard({ reward }: { reward: RewardRow }) {
  const [copied, setCopied] = useState(false);
  const freshlyEarned = Date.now() - new Date(reward.issuedAt).getTime() < ONE_DAY_MS;
  const expired = reward.offer.validTo ? new Date(reward.offer.validTo) < new Date() : false;
  const offerSummary = describeOffer(reward.offer);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reward.offer.code);
      setCopied(true);
      toast.success('Code copied — paste it at checkout');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — long-press to copy manually');
    }
  }

  return (
    <Card
      className={[
        'overflow-hidden border-warning/30',
        'bg-gradient-to-br from-warning/10 via-primary/5 to-card',
        freshlyEarned ? 'reveal pulse-soft shadow-lg shadow-warning/15' : ''
      ].join(' ')}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warning font-semibold">
              <Award className="size-3" /> Unlocked
              {freshlyEarned && <span className="text-success">· just now</span>}
            </div>
            <div className="font-semibold mt-0.5 truncate">{reward.challenge.name}</div>
          </div>
          {expired && <Badge variant="muted" className="text-[10px] shrink-0">Expired</Badge>}
          {!expired && reward.redeemed && <Badge variant="muted" className="text-[10px] shrink-0">Used</Badge>}
          {!expired && !reward.redeemed && <Badge variant="success" className="text-[10px] shrink-0">Ready</Badge>}
        </div>

        {/* Coupon code + copy button */}
        <div className="rounded-md border border-dashed border-warning/40 bg-background/60 p-2.5 flex items-center justify-between gap-2">
          <code className="font-mono font-semibold text-base tracking-wider truncate">{reward.offer.code}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={copy}
            disabled={expired}
            className="shrink-0"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="text-sm">
          <div className="font-medium">{offerSummary}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="size-3" />
            {reward.offer.validTo
              ? `Expires ${fmtDate(reward.offer.validTo, { dateStyle: 'medium' })}`
              : 'No expiry'}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground italic">
          Use at checkout — paste the code in the offers field.
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function estimatedReward(c: ChallengeRow): string {
  switch (c.rewardType) {
    case 'FIXED_OFF':     return `Unlock ${money(Number(c.rewardValue))} off`;
    case 'PERCENT_OFF':   return `Unlock ${Number(c.rewardValue)}% off`;
    case 'FREE_DELIVERY': return 'Unlock free delivery';
  }
}

function friendlyProgress(c: ChallengeRow): string {
  const v = c.progress.value;
  switch (c.type) {
    case 'ORDER_COUNT':
    case 'FIRST_N_ORDERS':
      return `${v} of ${c.target} order${c.target === 1 ? '' : 's'}`;
    case 'SPEND_THRESHOLD':
      return `${money(v)} of ${money(c.target)} spent`;
    case 'CUISINE_VARIETY':
      return `${v} of ${c.target} cuisines tried`;
    case 'WEEKEND_STREAK':
      return `${v} of ${c.target} weekend${c.target === 1 ? '' : 's'} in a row`;
  }
}

function qualifyText(c: ChallengeRow): string {
  const min = c.minOrderValue && Number(c.minOrderValue) > 0
    ? ` Only orders of ${money(Number(c.minOrderValue))} or more count.`
    : '';
  const window =
    c.window === 'WEEKLY'  ? ' Resets every week.'   :
    c.window === 'MONTHLY' ? ' Resets every month.'  :
    c.window === 'CUSTOM'  ? ' For a limited time only.' : '';
  switch (c.type) {
    case 'ORDER_COUNT':
      return `Complete ${c.target} delivered orders to unlock the reward.${min}${window}`;
    case 'FIRST_N_ORDERS':
      return `Your first ${c.target} orders count. The reward drops automatically the moment you hit the target.${min}`;
    case 'SPEND_THRESHOLD':
      return `Spend a total of ${money(c.target)} on delivered orders.${min}${window}`;
    case 'CUISINE_VARIETY':
      return `Order from ${c.target} different restaurants to unlock the reward.${min}${window}`;
    case 'WEEKEND_STREAK':
      return `Place at least one order on ${c.target} consecutive weekends. Miss a weekend and the streak restarts.${min}`;
  }
}

function describeOffer(o: RewardRow['offer']): string {
  if (o.percentOff != null) {
    const cap = o.maxDiscount ? ` (up to ${money(Number(o.maxDiscount))})` : '';
    return `${o.percentOff}% off${cap}`;
  }
  if (o.flatOff != null) {
    return `${money(Number(o.flatOff))} off`;
  }
  return o.type === 'FREE_DELIVERY' ? 'Free delivery' : 'Discount';
}
