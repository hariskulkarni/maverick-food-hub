'use client';
import { useCart } from '../cart-context';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Minus, Plus, Trash2, ShoppingBag, Gift, ChevronDown, Tag } from 'lucide-react';
import { money } from '@/lib/utils';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useState } from 'react';
import { OffersSection } from './offers-section';
import { CrossSellStrip } from '../menu/cross-sell-strip';
import { CartSavingsCelebration } from '@/components/cart/savings-celebration';

// Live preview of the signup-bonus the customer would get applied to this
// cart. The hook handles the 401 (logged-out) case by silently returning
// null — the calling JSX renders nothing in that case. Subtotal changes are
// debounced 300ms so we don't hammer the preview endpoint while the user
// adjusts quantities.
function useSignupBonusPreview(cartSubtotal: number) {
  const [result, setResult] = useState<{ appliedAmount: number; remainingOrders: number; remainingBalance: number } | null>(null);
  useEffect(() => {
    if (cartSubtotal <= 0) { setResult(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/customer/signup-bonus/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cartSubtotal })
        });
        if (!r.ok) { if (!cancelled) setResult(null); return; }
        const j = await r.json();
        if (!cancelled) setResult(j);
      } catch {
        if (!cancelled) setResult(null);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cartSubtotal]);
  return result;
}

export function CartClient({ branchId }: { branchId: string | null }) {
  const { lines, setQty, remove, subtotal } = useCart();
  const [notes, setNotes] = useState('');
  // The cart mounts TWO <OffersSection> instances — one in the mobile summary
  // accordion (md:hidden) and one in the desktop sidebar (hidden md:block).
  // Both stay mounted at every viewport (CSS display:none doesn't unmount a
  // React subtree), and each owns its own coupon state. If they both wrote to a
  // single `offerSavings`, the still-mounted, non-interacted instance would
  // clobber the interacted one's value on re-render — which made the savings
  // celebration fire only on whichever instance happened to "win" the race
  // (mobile, in practice). We keep a separate value per instance and use the
  // MAX: the auto-applied portion is identical across both, and only the
  // instance the user actually interacted with carries the applied coupon, so
  // the max is always the correct savings to display + celebrate.
  const [offerSavingsMobile, setOfferSavingsMobile] = useState(0);
  const [offerSavingsDesktop, setOfferSavingsDesktop] = useState(0);
  const offerSavings = Math.max(offerSavingsMobile, offerSavingsDesktop);
  const bonus = useSignupBonusPreview(subtotal);

  // The branch the cart's items actually belong to. Lines carry their branchId
  // at add-time; we use that so offers/coupons scope to the RIGHT restaurant.
  // Falls back to the server-resolved branch for legacy carts (items added
  // before branchId tracking existed).
  const effectiveBranchId = lines.find((l) => l.branchId)?.branchId ?? branchId;

  // Combined savings for the celebration: signup bonus + offer/coupon savings.
  const totalSavings = (bonus?.appliedAmount ?? 0) + offerSavings;

  if (lines.length === 0)
    return (
      <div className="container py-12">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Find something delicious — biryani, kebabs, or a comforting dal."
          action={
            <Button asChild>
              <Link href="/menu">Browse menu</Link>
            </Button>
          }
        />
      </div>
    );

  // Item IDs in cart that map to a menuItemId (skip combos — cross-sell takes raw menu items).
  const cartItemIds = lines.filter((l) => l.kind === 'item').map((l) => l.refId);

  // Mobile order-summary accordion. Defaults closed; tapping the row toggles.
  // The actual "Place order" CTA lives outside the accordion as a fixed bar so
  // it's always reachable regardless of accordion state.
  // Estimated total reflects BOTH the signup bonus and the auto-applied
  // offer/coupon savings (taxes + delivery are still added at checkout — hence
  // the trailing "+").
  const totalDue = Math.max(0, subtotal - (bonus?.appliedAmount ?? 0) - offerSavings);
  const checkoutHref = (() => {
    const params = new URLSearchParams();
    if (effectiveBranchId) params.set('branchId', effectiveBranchId);
    if (notes) params.set('notes', notes);
    const qs = params.toString();
    return qs ? `/checkout?${qs}` : '/checkout';
  })();

  return (
    <div className="container py-6 md:py-8 grid gap-6 md:gap-8 md:grid-cols-[1fr_360px] pb-[120px] md:pb-8">
      <section>
        <h1 className="display text-xl md:text-2xl font-semibold mb-4">
          Your cart ({lines.length} item{lines.length === 1 ? '' : 's'})
        </h1>

        {/* Savings celebration — confetti + splash popup + replayable chip. */}
        <CartSavingsCelebration savings={totalSavings} />

        <Card className="rounded-2xl md:rounded-xl">
          <CardContent className="p-0 divide-y">
            {/*
              Mobile-first line item: on phones (<md) the row is image+text only.
              The qty stepper + line total sit on a SECOND row beneath the text,
              spanning the full card width so the 44×44 controls + price label
              always have room to breathe at 360-414 px.

              On md+ we keep the original horizontal layout: image left,
              flex-1 text middle, right column with stepper + total.
            */}
            {lines.map((l) => (
              <div key={l.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:gap-4">
                <div className="flex items-start gap-3 md:contents">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    <Image src={l.imageUrl || FOOD_FALLBACK} alt={l.name} fill loading="lazy" sizes="64px" className="object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {l.isVeg !== undefined && (
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                            l.isVeg ? 'border-success' : 'border-destructive'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${l.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                        </span>
                      )}
                      <div className="font-medium truncate">{l.name}</div>
                    </div>
                    {(l.variantName || l.modifiersSummary) && (
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        {[l.variantName, l.modifiersSummary].filter(Boolean).join(' • ')}
                      </div>
                    )}
                    <div className="mt-1 text-sm text-muted-foreground">{money(l.unitPrice)} each</div>
                  </div>
                </div>
                {/* Phone: full-width stepper-and-total bar under the text.
                    Desktop: vertical right column, identical to the original. */}
                <div className="flex items-center justify-between gap-3 md:flex-col md:items-end md:gap-2">
                  {/* 44×44 controls on mobile; condensed on md+. */}
                  <div className="flex items-center rounded-md border bg-background">
                    <button
                      className="h-11 w-11 md:h-8 md:w-8 grid place-items-center hover:bg-accent"
                      aria-label="Decrease"
                      onClick={() => (l.quantity <= 1 ? remove(l.id) : setQty(l.id, l.quantity - 1))}
                    >
                      {l.quantity <= 1 ? <Trash2 className="size-4 text-destructive" /> : <Minus className="size-4" />}
                    </button>
                    <span className="w-8 text-center text-sm font-semibold font-tabular-nums">{l.quantity}</span>
                    <button
                      className="h-11 w-11 md:h-8 md:w-8 grid place-items-center hover:bg-accent"
                      aria-label="Increase"
                      onClick={() => setQty(l.id, l.quantity + 1)}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <div className="font-semibold font-tabular-nums">{money(l.unitPrice * l.quantity)}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Cross-sell row — silently hides if API returns empty */}
        {effectiveBranchId && cartItemIds.length > 0 && (
          <CrossSellStrip surface="cart" branchId={effectiveBranchId} itemIds={cartItemIds} />
        )}

        <Card className="mt-4 rounded-2xl md:rounded-xl">
          <CardContent className="p-4">
            <label className="text-sm font-medium">Notes for the kitchen</label>
            <Textarea
              className="mt-2"
              rows={3}
              placeholder="Less spicy, no onions, deliver to security gate, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Mobile-only collapsible order summary — desktop renders the rich
            sidebar via the <aside> below. Uses <details> for zero-JS state. */}
        <details className="md:hidden mt-4 group rounded-2xl border bg-card open:shadow-sm transition-shadow">
          <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none">
            <div className="text-sm">
              <div className="font-semibold">Order summary</div>
              <div className="text-xs text-muted-foreground font-tabular-nums">{money(totalDue)}+ estimated</div>
            </div>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 space-y-4">
            <OffersSection branchId={effectiveBranchId} onSavings={setOfferSavingsMobile} />
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={money(subtotal)} />
              {bonus && bonus.appliedAmount > 0 && (
                <div className="flex justify-between text-success">
                  <dt className="flex items-center gap-1.5">
                    <Gift className="size-3.5" /> Signup bonus
                  </dt>
                  <dd className="font-medium font-tabular-nums">−{money(bonus.appliedAmount)}</dd>
                </div>
              )}
              {offerSavings > 0 && (
                <div className="flex justify-between text-success">
                  <dt className="flex items-center gap-1.5">
                    <Tag className="size-3.5" /> Offers &amp; coupons
                  </dt>
                  <dd className="font-medium font-tabular-nums">−{money(offerSavings)}</dd>
                </div>
              )}
              <Row label="Tax & fees" value="Calculated at checkout" />
              <Row label="Delivery" value="Calculated at checkout" />
            </dl>
            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm text-muted-foreground">Estimated total</div>
              <div className="text-right">
                <div className="text-lg font-semibold font-tabular-nums">{money(totalDue)}+</div>
                <div className="text-[10px] font-normal text-muted-foreground">+ taxes &amp; delivery at checkout</div>
              </div>
            </div>
            {bonus && bonus.appliedAmount > 0 && bonus.remainingOrders > 0 && (
              <p className="text-[11px] text-muted-foreground text-right">
                {bonus.remainingOrders} of your signup bonus orders remaining.
              </p>
            )}
          </div>
        </details>
      </section>

      {/* Desktop sticky sidebar (md+) */}
      <aside className="hidden md:block md:sticky md:top-20 self-start space-y-4">
        <OffersSection branchId={effectiveBranchId} onSavings={setOfferSavingsDesktop} />

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold">Order summary</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Subtotal" value={money(subtotal)} />
              {bonus && bonus.appliedAmount > 0 && (
                <div className="flex justify-between text-success">
                  <dt className="flex items-center gap-1.5">
                    <Gift className="size-3.5" /> Signup bonus
                  </dt>
                  <dd className="font-medium tabular-nums">−{money(bonus.appliedAmount)}</dd>
                </div>
              )}
              {offerSavings > 0 && (
                <div className="flex justify-between text-success">
                  <dt className="flex items-center gap-1.5">
                    <Tag className="size-3.5" /> Offers &amp; coupons
                  </dt>
                  <dd className="font-medium tabular-nums">−{money(offerSavings)}</dd>
                </div>
              )}
              <Row label="Tax & fees" value="Calculated at checkout" />
              <Row label="Delivery" value="Calculated at checkout" />
            </dl>
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <div className="text-sm text-muted-foreground">Estimated total</div>
              <div className="text-right">
                <div className="text-lg font-semibold font-tabular-nums">{money(totalDue)}+</div>
                <div className="text-[10px] font-normal text-muted-foreground">+ taxes &amp; delivery at checkout</div>
              </div>
            </div>
            {bonus && bonus.appliedAmount > 0 && bonus.remainingOrders > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground text-right">
                {bonus.remainingOrders} of your signup bonus orders remaining.
              </p>
            )}
            <Button className="mt-4 w-full" size="lg" asChild>
              <Link href={checkoutHref}>Proceed to checkout</Link>
            </Button>
            {/* "Continue browsing" link — desktop only. Mobile gets Explore in the bottom nav. */}
            <Link href="/menu" className="mt-3 block text-center text-sm text-muted-foreground hover:text-foreground">
              ← Add more items
            </Link>
          </CardContent>
        </Card>
      </aside>

      {/* Mobile fixed "Place order" bar — sits above the bottom nav (56px) and
          respects iOS safe-area. Always visible while there are lines in the
          cart, regardless of accordion state. */}
      <div className="md:hidden fixed inset-x-0 cart-cta-bottom z-30 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="container py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-muted-foreground">{lines.length} item{lines.length === 1 ? '' : 's'} · est. total</div>
            <div className="text-base font-semibold font-tabular-nums truncate">{money(totalDue)}+</div>
          </div>
          <Button asChild size="lg" className="h-12 px-5 rounded-full shadow-lg shadow-primary/30">
            <Link href={checkoutHref}>Place order</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
