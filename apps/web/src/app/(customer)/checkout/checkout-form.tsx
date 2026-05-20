'use client';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCart } from '../cart-context';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { Wallet, Sparkles, Bike, ShoppingBag, UtensilsCrossed, MapPin, CalendarClock, Gift } from 'lucide-react';

interface Addr { id: string; label: string; line1: string; line2?: string | null; city: string; postalCode: string; isDefault?: boolean; }

type FulfillmentType = 'DELIVERY' | 'PICKUP' | 'DINE_IN';

interface FulfillmentCtx {
  restaurantSlug: string;
  branchName: string;
  branchAddress: string;
  scheduledOrdersEnabled: boolean;
  selfPickupEnabled: boolean;
  dineInEnabled: boolean;
  reservationDiscountPct: number;
}

interface ReservationLite {
  id: string;
  code: string;
  status: string;
  reservedAt: string;
  tableName: string | null;
  partySize: number;
  depositAmount: number;
  depositPaid: boolean;
  discountPct: number;
}

export function CheckoutForm({ branchId, addresses, walletBalance, loyaltyPoints, fulfillment }: {
  branchId: string;
  addresses: Addr[];
  walletBalance: number;
  loyaltyPoints: number;
  fulfillment: FulfillmentCtx;
}) {
  const { lines, clear } = useCart();
  const router = useRouter();
  const [addressId, setAddressId] = useState<string>(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? '');
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [walletApply, setWalletApply] = useState(false);
  const [loyaltyApply, setLoyaltyApply] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'RAZORPAY' | 'COD'>('RAZORPAY');
  const [notes, setNotes] = useState('');
  const [pricing, setPricing] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // Freebie/gift nudge — driven off the cart subtotal. `qualifying` is the
  // gift the cart has already earned; `nextThreshold` is the "spend ₹X more"
  // teaser toward the next tier. Both null when freebies are off / unavailable.
  const [freebie, setFreebie] = useState<{
    qualifying: { itemName: string } | null;
    nextThreshold: { itemName: string; amountAway: number } | null;
  } | null>(null);

  // ── Fulfillment + scheduling state ─────────────────────────────────────────
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('DELIVERY');
  const isDelivery = fulfillmentType === 'DELIVERY';
  const isPickup = fulfillmentType === 'PICKUP';
  const isDineIn = fulfillmentType === 'DINE_IN';

  // Dine-in reservation picker. Reservations are fetched lazily the first time
  // the customer switches to Dine-in. Only CONFIRMED bookings can back an order.
  const [reservations, setReservations] = useState<ReservationLite[] | null>(null);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [reservationId, setReservationId] = useState<string>('');

  // Scheduled ordering. When "later", scheduledAt holds a datetime-local string.
  const [schedule, setSchedule] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');

  // Lazy-load the customer's reservations for the dine-in flow.
  useEffect(() => {
    if (!isDineIn || reservations !== null || reservationsLoading) return;
    let cancelled = false;
    setReservationsLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/r/${fulfillment.restaurantSlug}/reservations`, { cache: 'no-store' });
        const j = await r.json();
        if (!cancelled) setReservations(Array.isArray(j.reservations) ? j.reservations : []);
      } catch {
        if (!cancelled) setReservations([]);
      } finally {
        if (!cancelled) setReservationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDineIn, reservations, reservationsLoading, fulfillment.restaurantSlug]);

  // Only CONFIRMED reservations can be redeemed by an order (server enforces
  // this too; we filter here so the customer never picks an invalid one).
  const eligibleReservations = (reservations ?? []).filter((r) => r.status === 'CONFIRMED');
  const selectedReservation = eligibleReservations.find((r) => r.id === reservationId) ?? null;

  // Recalculate pricing whenever inputs change
  useEffect(() => {
    if (lines.length === 0) return;
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/checkout/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          // Pickup + dine-in carry no delivery address → no delivery fee in the quote.
          addressId: isDelivery ? (addressId || undefined) : undefined,
          // Lets the quote zero the packaging fee for dine-in so the preview total
          // matches the order total computed server-side.
          fulfillmentType,
          items: lines.map((l) => ({ menuItemId: l.kind === 'item' ? l.refId : undefined, comboId: l.kind === 'combo' ? l.refId : undefined, quantity: l.quantity })),
          couponCode: appliedCoupon || undefined,
          walletApply: walletApply ? Math.min(walletBalance, 500) : 0,
          loyaltyApply: loyaltyApply ? Math.min(loyaltyPoints, 200) : 0
        })
      });
      const j = await r.json();
      if (!cancelled) setPricing(j);
    })();
    return () => { cancelled = true; };
  }, [lines, addressId, appliedCoupon, walletApply, loyaltyApply, branchId, walletBalance, loyaltyPoints, isDelivery, fulfillmentType]);

  // Re-check the qualifying freebie whenever the subtotal changes. Public
  // endpoint, resolved by restaurant slug — reuses the core selection engine.
  const subtotal = pricing?.subtotal;
  useEffect(() => {
    if (typeof subtotal !== 'number' || subtotal <= 0) { setFreebie(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/r/${fulfillment.restaurantSlug}/freebies?subtotal=${subtotal}`, { cache: 'no-store' });
        const j = await r.json();
        if (!cancelled) {
          setFreebie(j.allowFreebies ? { qualifying: j.qualifying, nextThreshold: j.nextThreshold } : null);
        }
      } catch {
        if (!cancelled) setFreebie(null);
      }
    })();
    return () => { cancelled = true; };
  }, [subtotal, fulfillment.restaurantSlug]);

  if (lines.length === 0) {
    return <div>Your cart is empty. <Link className="text-primary underline" href="/menu">Browse menu</Link></div>;
  }

  async function applyCoupon() {
    setAppliedCoupon(coupon.trim().toUpperCase() || null);
  }

  async function placeOrder() {
    if (isDelivery && !addressId) return toast.error('Pick a delivery address');
    if (isDineIn && !reservationId) return toast.error('Pick the reservation this order redeems');

    // Resolve the scheduled slot (if any). Validate it's in the future before
    // we ship it to the server (the server re-checks against operating hours).
    let scheduledForIso: string | null = null;
    if (fulfillment.scheduledOrdersEnabled && schedule === 'later') {
      if (!scheduledAt) return toast.error('Pick a date and time for your scheduled order');
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) return toast.error('That scheduled time is invalid');
      if (when.getTime() <= Date.now()) return toast.error('Scheduled time must be in the future');
      scheduledForIso = when.toISOString();
    }

    setBusy(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          // Address only travels with a delivery order.
          addressId: isDelivery ? addressId : undefined,
          items: lines.map((l) => ({
            menuItemId: l.kind === 'item' ? l.refId : undefined,
            comboId: l.kind === 'combo' ? l.refId : undefined,
            quantity: l.quantity,
            notes: l.notes,
            // Variant + modifier selections — the server re-prices from these.
            selectedVariantId: l.selectedVariantId ?? undefined,
            selectedModifierOptionIds: l.selectedModifierOptionIds ?? undefined
          })),
          couponCode: appliedCoupon || undefined,
          paymentMethod,
          customerNotes: notes,
          walletApply: walletApply ? Math.min(walletBalance, 500) : 0,
          loyaltyApply: loyaltyApply ? Math.min(loyaltyPoints, 200) : 0,
          fulfillmentType,
          reservationId: isDineIn ? reservationId : undefined,
          scheduledFor: scheduledForIso
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to place order');
      }
      const data = await res.json();
      clear();
      // Surface the pickup handover code immediately on a successful pickup order.
      if (data.fulfillmentType === 'PICKUP' && data.pickupCode) {
        toast.success(`Order placed! Your pickup code is ${data.pickupCode}`);
      }
      if (paymentMethod === 'COD') {
        if (data.fulfillmentType !== 'PICKUP') toast.success('Order placed! Track it now.');
        router.push(`/orders/${data.orderId}`);
      } else {
        // For mock provider we auto-confirm; for real Razorpay you'd open the checkout SDK here.
        if (data.payment?.providerName === 'mock') {
          // confirm immediately
          await fetch(`/api/orders/${data.orderId}/confirm-mock-payment`, { method: 'POST' });
          toast.success('Payment captured (mock)');
          router.push(`/orders/${data.orderId}`);
        } else {
          // Real Razorpay SDK call would go here.
          router.push(`/orders/${data.orderId}`);
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Whether either non-delivery option is even on the menu for this restaurant.
  const showFulfillmentChooser = fulfillment.selfPickupEnabled || fulfillment.dineInEnabled;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {showFulfillmentChooser && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3">How would you like your order?</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <FulfillmentChoice value="DELIVERY" current={fulfillmentType} onChange={setFulfillmentType} icon={Bike} title="Delivery" subtitle="To your door" />
                {fulfillment.selfPickupEnabled && (
                  <FulfillmentChoice value="PICKUP" current={fulfillmentType} onChange={setFulfillmentType} icon={ShoppingBag} title="Pickup" subtitle="Collect yourself" />
                )}
                {fulfillment.dineInEnabled && (
                  <FulfillmentChoice value="DINE_IN" current={fulfillmentType} onChange={setFulfillmentType} icon={UtensilsCrossed} title="Dine-in" subtitle="At your table" />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isDelivery && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3">Deliver to</h3>
              {addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No addresses yet. <Link href="/profile/addresses/new" className="text-primary underline">Add one</Link>.</p>
              ) : (
                <div className="space-y-2">
                  {addresses.map((a) => (
                    <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent ${addressId === a.id ? 'border-primary bg-primary/5' : ''}`}>
                      <input type="radio" className="mt-1" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-sm text-muted-foreground">
                          {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postalCode}
                        </div>
                      </div>
                    </label>
                  ))}
                  <Link href="/profile/addresses/new" className="text-sm text-primary hover:underline">+ Add another address</Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isPickup && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><MapPin className="size-4 text-primary" /> Pick up at {fulfillment.branchName}</h3>
              <p className="text-sm text-muted-foreground">{fulfillment.branchAddress}</p>
              <p className="mt-2 text-xs text-muted-foreground">No delivery fee. You'll get a pickup code to show at the counter when your order is ready.</p>
            </CardContent>
          </Card>
        )}

        {isDineIn && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><UtensilsCrossed className="size-4 text-primary" /> Redeem a reservation</h3>
              {reservationsLoading ? (
                <p className="text-sm text-muted-foreground">Loading your reservations…</p>
              ) : eligibleReservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You have no confirmed reservation at {fulfillment.branchName}.{' '}
                  <Link href={`/r/${fulfillment.restaurantSlug}/reserve`} className="text-primary underline">Reserve a table</Link> first.
                </p>
              ) : (
                <div className="space-y-2">
                  {eligibleReservations.map((r) => (
                    <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent ${reservationId === r.id ? 'border-primary bg-primary/5' : ''}`}>
                      <input type="radio" className="mt-1" checked={reservationId === r.id} onChange={() => setReservationId(r.id)} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {r.tableName ? `Table ${r.tableName}` : `Reservation ${r.code}`} · party of {r.partySize}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(r.reservedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        <div className="mt-1 text-xs text-success">
                          {r.discountPct}% off your bill
                          {r.depositPaid && r.depositAmount > 0 ? ` · ${money(r.depositAmount)} deposit credited` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {fulfillment.scheduledOrdersEnabled && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><CalendarClock className="size-4 text-primary" /> When?</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <FulfillmentChoice value="now" current={schedule} onChange={setSchedule} title="Order now" subtitle="As soon as possible" />
                <FulfillmentChoice value="later" current={schedule} onChange={setSchedule} title="Schedule for later" subtitle="Pick a date & time" />
              </div>
              {schedule === 'later' && (
                <div className="mt-3">
                  <Label htmlFor="scheduledAt">Scheduled time</Label>
                  <Input
                    id="scheduledAt"
                    type="datetime-local"
                    className="mt-2"
                    value={scheduledAt}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Coupon</h3>
            <div className="flex gap-2">
              <Input placeholder="WELCOME50" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
              <Button onClick={applyCoupon} variant="outline">Apply</Button>
            </div>
            {appliedCoupon && pricing?.couponApplied && (
              <p className="mt-2 text-sm text-success">✓ {appliedCoupon} applied — saved {money(pricing.discountAmount)}</p>
            )}
            {appliedCoupon && pricing && !pricing.couponApplied && (
              <p className="mt-2 text-sm text-destructive">Coupon "{appliedCoupon}" doesn't apply.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-semibold">Use rewards</h3>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2"><Wallet className="size-4" /><div className="text-sm">Wallet — {money(walletBalance)} available</div></div>
              <Switch checked={walletApply} onCheckedChange={setWalletApply} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2"><Sparkles className="size-4" /><div className="text-sm">Loyalty — {loyaltyPoints} pts (1 pt = ₹1)</div></div>
              <Switch checked={loyaltyApply} onCheckedChange={setLoyaltyApply} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Payment</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <PaymentChoice value="RAZORPAY" current={paymentMethod} onChange={setPaymentMethod} title="Online (UPI / Card / Wallet)" subtitle="Razorpay, secure" />
              <PaymentChoice value="COD" current={paymentMethod} onChange={setPaymentMethod} title="Cash on Delivery" subtitle="Pay the rider" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <Label htmlFor="notes">Order notes</Label>
            <Input id="notes" className="mt-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. less spicy, ring the bell" />
          </CardContent>
        </Card>
      </div>

      <aside className="md:sticky md:top-20 self-start">
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold">Order summary</h3>
            <ul className="mt-3 space-y-1 text-sm">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span className="truncate">{l.quantity}× {l.name}</span>
                  <span>{money(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
            </ul>
            {pricing && (
              <dl className="mt-4 space-y-1 text-sm border-t pt-3">
                <Row label="Subtotal" value={money(pricing.subtotal)} />
                {pricing.discountAmount > 0 && <Row label="Discount" value={'−' + money(pricing.discountAmount)} />}
                {pricing.walletApplied > 0 && <Row label="Wallet" value={'−' + money(pricing.walletApplied)} />}
                {pricing.loyaltyApplied > 0 && <Row label="Loyalty" value={'−' + money(pricing.loyaltyApplied)} />}
                <Row label={`Tax (${pricing.taxRatePct ?? ''}%)`} value={money(pricing.taxAmount)} />
                {pricing.packagingFee > 0 && (
                  <Row label="Restaurant Packaging" value={money(pricing.packagingFee)} />
                )}
                {isDelivery && (
                  <Row label={`Delivery${pricing.distanceKm ? ` (~${pricing.distanceKm} km)` : ''}`} value={money(pricing.deliveryFee)} />
                )}
                <div className="flex justify-between border-t pt-2 mt-2 font-semibold text-base">
                  <span>Total</span><span>{money(pricing.total)}</span>
                </div>
                {freebie?.qualifying && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    <Gift className="size-4 shrink-0 mt-0.5" />
                    <span>You've earned a free <span className="font-semibold">{freebie.qualifying.itemName}</span>! It'll be added to your order.</span>
                  </div>
                )}
                {!freebie?.qualifying && freebie?.nextThreshold && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    <Gift className="size-4 shrink-0 mt-0.5 text-primary" />
                    <span>Spend {money(freebie.nextThreshold.amountAway)} more for a free <span className="font-medium text-foreground">{freebie.nextThreshold.itemName}</span>.</span>
                  </div>
                )}
                {isDineIn && selectedReservation && (
                  <p className="mt-2 text-xs text-success">
                    Dine-in: {selectedReservation.discountPct}% off applied at checkout
                    {selectedReservation.depositPaid && selectedReservation.depositAmount > 0
                      ? ` + ${money(selectedReservation.depositAmount)} deposit credit`
                      : ''}. Final total is calculated when you place the order.
                  </p>
                )}
              </dl>
            )}
            <Button className="mt-4 w-full" size="lg" onClick={placeOrder} disabled={busy || !pricing}>
              {busy ? 'Placing order…' : `Place order · ${money(pricing?.total ?? 0)}`}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground text-center">By placing this order you agree to our Terms.</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
}

// Generic selectable tile reused by the fulfillment-type chooser and the
// now/later schedule toggle. `value` is parameterised so each caller stays
// type-safe over its own union.
function FulfillmentChoice<T extends string>({ value, current, onChange, title, subtitle, icon: Icon }: {
  value: T;
  current: T;
  onChange: (v: T) => void;
  title: string;
  subtitle: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`text-left rounded-lg border p-3 hover:bg-accent ${active ? 'border-primary bg-primary/5' : ''}`}
    >
      <div className="text-sm font-medium flex items-center gap-1.5">{Icon && <Icon className="size-4 text-primary" />}{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </button>
  );
}

function PaymentChoice({ value, current, onChange, title, subtitle }: { value: 'RAZORPAY' | 'COD'; current: string; onChange: (v: 'RAZORPAY' | 'COD') => void; title: string; subtitle: string }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`text-left rounded-lg border p-3 hover:bg-accent ${active ? 'border-primary bg-primary/5' : ''}`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </button>
  );
}
