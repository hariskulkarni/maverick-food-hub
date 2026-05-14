'use client';
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
import { Tag, Wallet, Sparkles } from 'lucide-react';

interface Addr { id: string; label: string; line1: string; line2?: string | null; city: string; postalCode: string; isDefault?: boolean; }

export function CheckoutForm({ branchId, addresses, walletBalance, loyaltyPoints }: {
  branchId: string;
  addresses: Addr[];
  walletBalance: number;
  loyaltyPoints: number;
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
          addressId: addressId || undefined,
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
  }, [lines, addressId, appliedCoupon, walletApply, loyaltyApply, branchId, walletBalance, loyaltyPoints]);

  if (lines.length === 0) {
    return <div>Your cart is empty. <Link className="text-primary underline" href="/menu">Browse menu</Link></div>;
  }

  async function applyCoupon() {
    setAppliedCoupon(coupon.trim().toUpperCase() || null);
  }

  async function placeOrder() {
    if (!addressId) return toast.error('Pick a delivery address');
    setBusy(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          addressId,
          items: lines.map((l) => ({ menuItemId: l.kind === 'item' ? l.refId : undefined, comboId: l.kind === 'combo' ? l.refId : undefined, quantity: l.quantity, notes: l.notes })),
          couponCode: appliedCoupon || undefined,
          paymentMethod,
          customerNotes: notes,
          walletApply: walletApply ? Math.min(walletBalance, 500) : 0,
          loyaltyApply: loyaltyApply ? Math.min(loyaltyPoints, 200) : 0
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to place order');
      }
      const data = await res.json();
      clear();
      if (paymentMethod === 'COD') {
        toast.success('Order placed! Track it now.');
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

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div className="space-y-4">
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
                <Row label={`Delivery${pricing.distanceKm ? ` (~${pricing.distanceKm} km)` : ''}`} value={money(pricing.deliveryFee)} />
                <div className="flex justify-between border-t pt-2 mt-2 font-semibold text-base">
                  <span>Total</span><span>{money(pricing.total)}</span>
                </div>
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
