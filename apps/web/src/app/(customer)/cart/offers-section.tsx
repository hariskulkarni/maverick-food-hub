'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Tag, Percent, Gift, Check, X, ChevronRight, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { money } from '@/lib/utils';
import { useCart } from '../cart-context';

interface OfferLike {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  code?: string | null;
  percentOff?: number | null;
  flatOff?: string | number | null;
  minOrderAmount?: string | number | null;
  autoApply?: boolean;
}

interface EvaluationEntry {
  offer: OfferLike;
  result:
    | { eligible: true; amountOff: number; affectedItemIds: string[]; breakdown: Record<string, unknown> }
    | { eligible: false; reason: string };
  customerRedemptions?: number;
}

interface EligibleResponse {
  bestPick: {
    winners: { offer: OfferLike; result: { eligible: true; amountOff: number } }[];
    totalAmountOff: number;
  };
  evaluations: EvaluationEntry[];
}

interface ApplyCodeResponse {
  winner: { offer: OfferLike; result: { eligible: true; amountOff: number } } | null;
  evaluation: EvaluationEntry | null;
  customerOrderCount: number;
  error?: string;
}

function iconForType(type: string) {
  switch (type) {
    case 'PERCENTAGE':
      return Percent;
    case 'FIXED':
      return Tag;
    case 'BUY_X_GET_Y':
    case 'COMBO_DISCOUNT':
    case 'FREE_ITEM_ABOVE':
      return Gift;
    case 'FIRST_ORDER':
      return Sparkles;
    case 'REPEAT_CUSTOMER':
      return Crown;
    default:
      return Tag;
  }
}

/**
 * Make a server-side eligibility reason human-readable. The resolver returns
 * messages like "cart subtotal must be at least ₹500" — those are fine to
 * surface as-is. We rewrite a few jargony ones and also detect close-but-
 * not-quite cases so we can show "Add ₹X more to unlock".
 */
function humanizeReason(reason: string): { msg: string; isUpsell: boolean } {
  // Resolver pattern: "cart subtotal must be at least ₹500"
  const minMatch = reason.match(/at least ₹(\d+(?:\.\d+)?)/);
  if (minMatch) {
    return { msg: `Add more items to reach ₹${minMatch[1]}`, isUpsell: true };
  }
  // Resolver pattern: "add ₹150 more to qualify"
  if (/add ₹\d+/i.test(reason)) {
    return { msg: reason.charAt(0).toUpperCase() + reason.slice(1), isUpsell: true };
  }
  if (/per-customer limit/i.test(reason)) return { msg: "You've already used this offer", isUpsell: false };
  if (/usage limit/i.test(reason)) return { msg: 'This offer has been fully claimed', isUpsell: false };
  if (/expired/i.test(reason)) return { msg: 'Offer expired', isUpsell: false };
  if (/not started/i.test(reason)) return { msg: 'Offer not active yet', isUpsell: false };
  if (/different restaurant|different branch/i.test(reason)) return { msg: 'Not valid here', isUpsell: false };
  if (/first-order/i.test(reason)) return { msg: 'For first-time customers only', isUpsell: false };
  if (/prior order/i.test(reason)) return { msg: reason, isUpsell: false };
  if (/redeemable on/i.test(reason)) return { msg: reason, isUpsell: false };
  if (/add .* to qualify/i.test(reason)) return { msg: reason, isUpsell: true };
  return { msg: reason, isUpsell: false };
}

export interface OffersSectionProps {
  branchId: string | null;
}

export function OffersSection({ branchId }: OffersSectionProps) {
  const { lines, subtotal } = useCart();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EligibleResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Coupon-code state (in-memory so it survives re-renders within this route).
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [appliedCode, setAppliedCode] = useState<{
    code: string;
    name: string;
    amountOff: number;
  } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Build the cart payload — only menu-item lines are eligible for offers.
  const cartPayload = useMemo(
    () =>
      lines
        .filter((l) => l.kind === 'item')
        .map((l) => ({
          menuItemId: l.refId,
          unitPrice: l.unitPrice,
          quantity: l.quantity
        })),
    [lines]
  );

  // Re-fetch eligible offers whenever the cart changes.
  useEffect(() => {
    if (cartPayload.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch('/api/customer/offers/eligible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId, cart: cartPayload })
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EligibleResponse | null) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, JSON.stringify(cartPayload)]); // eslint-disable-line react-hooks/exhaustive-deps

  const winners = data?.bestPick?.winners ?? [];
  const totalSaved = data?.bestPick?.totalAmountOff ?? 0;
  const winnerIds = new Set(winners.map((w) => w.offer.id));

  // Bucket evaluations:
  //   - Available to claim: eligible but not auto-picked (often code-only)
  //   - Coming up: ineligible but the resolver hinted an upsell
  const evaluations = data?.evaluations ?? [];
  const available = evaluations.filter(
    (e) => e.result.eligible && !winnerIds.has(e.offer.id)
  );
  const upcoming = evaluations
    .filter((e) => !e.result.eligible)
    .map((e) => ({ entry: e, parsed: !e.result.eligible ? humanizeReason(e.result.reason) : null }))
    .filter((x) => x.parsed?.isUpsell)
    .slice(0, 3);

  const applyCode = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setApplying(true);
    setCodeError(null);
    try {
      const res = await fetch('/api/customer/offers/apply-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, branchId, cart: cartPayload })
      });
      const payload: ApplyCodeResponse = await res.json();
      if (!res.ok || !payload.winner) {
        const reason = payload.evaluation && !payload.evaluation.result.eligible
          ? humanizeReason(payload.evaluation.result.reason).msg
          : payload.error || 'Code is invalid or not applicable';
        setAppliedCode(null);
        setCodeError(reason);
        return;
      }
      setAppliedCode({
        code: trimmed.toUpperCase(),
        name: payload.winner.offer.name,
        amountOff: payload.winner.result.amountOff
      });
      setCode('');
    } catch {
      setCodeError('Could not apply code — please try again');
    } finally {
      setApplying(false);
    }
  };

  // No offers and cart not empty? Render nothing rather than an empty card.
  const showAuto = winners.length > 0;
  const showAvailable = available.length > 0;
  const showUpcoming = upcoming.length > 0;
  const showAnything = loading || showAuto || showAvailable || showUpcoming || appliedCode || true;
  // "true" because the coupon input is always available.
  if (!showAnything) return null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Auto-applied banner */}
      {loading ? (
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
      ) : showAuto ? (
        <div className="relative overflow-hidden border-b bg-gradient-to-r from-success/10 via-primary/5 to-success/10 p-4">
          <div className="flex items-start gap-2">
            <div className="inline-flex items-center justify-center size-8 rounded-full bg-success/20 text-success shrink-0">
              <Sparkles className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-success">Auto-applied</div>
              <div className="font-semibold text-sm leading-snug truncate">
                Saved {money(totalSaved)} for you!
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {winners.map((w) => (
                  <span
                    key={w.offer.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[11px] font-medium"
                  >
                    <Tag className="size-3" />
                    {w.offer.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Coupon code input */}
      <div className="p-4 border-b">
        {appliedCode ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Check className="size-4 text-success shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-success truncate">
                  {appliedCode.code} applied — {money(appliedCode.amountOff)} off
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{appliedCode.name}</div>
              </div>
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove applied code"
              onClick={() => {
                setAppliedCode(null);
                setCodeError(null);
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-sm font-medium"
              aria-expanded={expanded}
            >
              <span className="inline-flex items-center gap-1.5">
                <Tag className="size-4 text-primary" /> Have a code?
              </span>
              <ChevronRight
                className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
            {expanded && (
              <div className="mt-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyCode();
                      }
                    }}
                    className="h-9 font-mono uppercase tracking-wider"
                    aria-label="Coupon code"
                  />
                  <Button size="sm" onClick={applyCode} disabled={applying || !code.trim()}>
                    {applying ? 'Applying…' : 'Apply'}
                  </Button>
                </div>
                {codeError && (
                  <div className="mt-2 text-xs text-destructive flex items-start gap-1">
                    <X className="size-3.5 mt-0.5 shrink-0" /> {codeError}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Available to claim */}
      {showAvailable && (
        <div className="p-4 border-b">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Available offers
          </div>
          <ul className="space-y-2">
            {available.map((e) => {
              const Icon = iconForType(e.offer.type);
              const amt = e.result.eligible ? e.result.amountOff : 0;
              return (
                <li
                  key={e.offer.id}
                  className="flex items-start gap-2 rounded-md border bg-background p-2"
                >
                  <div className="inline-flex items-center justify-center size-7 rounded-full bg-primary/10 text-primary shrink-0">
                    <Icon className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-snug truncate">{e.offer.name}</div>
                    {e.offer.code && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                        Code: <span className="font-bold text-foreground">{e.offer.code}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-success shrink-0">
                    {money(amt)} off
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Coming up — close but not quite */}
      {showUpcoming && (
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            More offers coming up
          </div>
          <ul className="space-y-2">
            {upcoming.map(({ entry, parsed }) => {
              const Icon = iconForType(entry.offer.type);
              return (
                <li
                  key={entry.offer.id}
                  className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-2"
                >
                  <div className="inline-flex items-center justify-center size-7 rounded-full bg-warning/15 text-warning shrink-0">
                    <Icon className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-snug truncate">{entry.offer.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                      {parsed?.msg}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Subtle subtotal hint if nothing else to show */}
      {!loading && !showAuto && !showAvailable && !showUpcoming && !appliedCode && (
        <div className="p-4 text-xs text-muted-foreground text-center">
          No active offers right now. Subtotal: {money(subtotal)}
        </div>
      )}
    </div>
  );
}
