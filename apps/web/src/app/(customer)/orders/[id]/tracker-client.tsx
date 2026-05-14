'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { money, fmtDate, STATUS_LABELS, STATUS_PROGRESSION } from '@/lib/utils';
import { useSSE } from '@/hooks/use-sse';
import { toast } from 'sonner';
import { CheckCircle2, Clock, ChefHat, Package, Bike, MapPin, Phone, MessageCircle, Heart, Sparkles, Copy, KeyRound, ShieldCheck, Star, MessageSquarePlus, Lock, MessageSquareText } from 'lucide-react';
import { brand } from '@/lib/brand';
import DeliveryMap from './delivery-map';
import { ReorderButton } from './reorder-button';
import { FeedbackDialog, type FeedbackLite } from '../feedback-dialog';

// Equirectangular distance approximation in km between two lat/lng points.
// Used for the saffron ETA pill ("arriving in ~N min · 0.8 km away").
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function OrderTrackerClient({
  order: initial,
  existingFeedback: initialFeedback = null,
  deliveredAt = null,
  feedbackWindowEndsAt = null
}: {
  order: any;
  existingFeedback?: FeedbackLite | null;
  deliveredAt?: string | null;
  feedbackWindowEndsAt?: string | null;
}) {
  const [order, setOrder] = useState(initial);
  const [feedback, setFeedback] = useState<FeedbackLite | null>(initialFeedback);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackWindowClosed = feedbackWindowEndsAt
    ? new Date(feedbackWindowEndsAt).getTime() < Date.now()
    : false;
  const [mapSeed, setMapSeed] = useState<{ rider: { lat: number; lng: number } | null; trail: { lat: number; lng: number }[] } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  // Live rider position kept in component state so the saffron pill above the
  // map can recompute its ETA on every SSE `location` event.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);
  const lastStatusRef = useRef<string>(initial.status);
  // One-shot guards — keyed by order so a flaky SSE reconnect can't double-fire.
  const nearbyFiredRef = useRef<Set<string>>(new Set());
  const reachedFiredRef = useRef<Set<string>>(new Set());

  useSSE(`order:${order.id}`, {
    onMessage: (evt: any) => {
      if (evt.kind === 'status') {
        setOrder((o: any) => ({ ...o, status: evt.status, statusEvents: [...(o.statusEvents ?? []), { status: evt.status, createdAt: evt.at }] }));
        // Push-style toast on RIDER_REACHED_CUSTOMER — fires once per order.
        if (evt.status === 'RIDER_REACHED_CUSTOMER' && !reachedFiredRef.current.has(order.id)) {
          reachedFiredRef.current.add(order.id);
          toast.success('Your rider is at the door — please head out with your OTP.');
        }
      }
      if (evt.kind === 'location') {
        const pos = { lat: evt.lat, lng: evt.lng };
        setRiderPos(pos);
        setOrder((o: any) => ({ ...o, riderLocation: pos }));
      }
      if (evt.kind === 'rider:nearby' && !nearbyFiredRef.current.has(order.id)) {
        nearbyFiredRef.current.add(order.id);
        toast.info('Your rider is 2 min away');
      }
    }
  });

  // Trigger celebration on DELIVERED transition
  useEffect(() => {
    if (order.status === 'DELIVERED' && lastStatusRef.current !== 'DELIVERED') {
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), 4_000);
      return () => clearTimeout(t);
    }
    lastStatusRef.current = order.status;
  }, [order.status]);

  // Load initial rider position + trail when status hits OUT_FOR_DELIVERY
  useEffect(() => {
    if (order.status !== 'OUT_FOR_DELIVERY' || mapSeed) return;
    fetch(`/api/orders/${order.id}/location`).then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return;
      setMapSeed(d);
      if (d.rider) setRiderPos(d.rider);
    });
  }, [order.status, order.id, mapSeed]);

  // Customer drop coordinates — used both by the map (already) and by the
  // ETA pill above it. May be null on legacy orders without geocoded addresses.
  const dropPoint = useMemo(() => (
    order.address?.latitude != null && order.address?.longitude != null
      ? { lat: Number(order.address.latitude), lng: Number(order.address.longitude) }
      : null
  ), [order.address?.latitude, order.address?.longitude]);

  // Live ETA pill — recomputes every time `riderPos` ticks. 25 km/h is the
  // same assumption the rider-side map uses, so both screens agree.
  const liveEta = useMemo(() => {
    if (!riderPos || !dropPoint || order.status !== 'OUT_FOR_DELIVERY') return null;
    const km = haversineKm(riderPos, dropPoint);
    const minutes = Math.max(1, Math.round((km / 25) * 60));
    return { km, minutes };
  }, [riderPos, dropPoint, order.status]);

  const idx = STATUS_PROGRESSION.indexOf(order.status as any);
  const isTerminal = ['CANCELLED', 'REFUNDED'].includes(order.status);
  const isDelivered = order.status === 'DELIVERED';

  // ETA — naive client estimate based on remaining stages
  const etaMins = useMemo(() => {
    if (idx < 0 || isTerminal || isDelivered) return null;
    const stagesLeft = STATUS_PROGRESSION.length - idx - 1;
    return Math.max(5, stagesLeft * 7 + 3); // rough heuristic
  }, [idx, isTerminal, isDelivered]);

  return (
    <div className="container py-8 max-w-4xl">
      {celebrating && <Confetti />}

      <header className="flex flex-wrap items-center justify-between gap-3 mb-6 reveal">
        <div>
          <h1 className="display text-xl md:text-2xl lg:text-3xl font-semibold flex items-center gap-2 md:gap-3 flex-wrap">
            <span>Order <span className="font-mono">{order.code}</span></span>
            <OrderStatusBadge status={order.status} />
          </h1>
          <p className="text-sm text-muted-foreground">Placed {fmtDate(order.placedAt)}</p>
        </div>
        {/* Support buttons — stack vertically on mobile, side-by-side on sm+.
            44×44 tap targets enforced on mobile. */}
        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex">
          <a href={`tel:${brand.supportPhone}`} className="inline-flex h-11 sm:h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-accent tap-press">
            <Phone className="size-4" /> Support
          </a>
          <a
            href={`https://wa.me/${brand.supportWhatsapp.replace(/\D/g, '')}?text=Order%20${encodeURIComponent(order.code)}`}
            target="_blank" rel="noreferrer"
            className="inline-flex h-11 sm:h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-accent tap-press"
          >
            <MessageCircle className="size-4" /> WhatsApp
          </a>
        </div>
      </header>

      {/* ───────────────────────── Progress stepper ───────────────────────── */}
      {!isTerminal && (
        <Card className="mb-6 overflow-hidden">
          <CardContent className="p-6">
            <Stepper progression={STATUS_PROGRESSION as readonly string[]} idx={idx} />
            <div className="mt-5 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                {idx < 0 && 'Waiting for confirmation…'}
                {idx >= 0 && !isDelivered && (
                  <>
                    Currently: <span className="font-medium text-foreground">{STATUS_LABELS[order.status]}</span>
                  </>
                )}
                {isDelivered && <span className="text-success font-medium inline-flex items-center gap-1.5"><Sparkles className="size-4" /> Delivered — hope you enjoy your meal!</span>}
              </p>
              {etaMins != null && (
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 font-medium">
                  <Clock className="size-3" /> ETA ~{etaMins} min
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ───────────────────────── Delivered hero ───────────────────────── */}
      {isDelivered && (
        <Card className="mb-6 overflow-hidden border-success/30 bg-gradient-to-br from-success/5 via-card to-warning/5 burst">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="grid size-14 place-items-center rounded-2xl bg-success text-success-foreground ring-4 ring-success/20 shadow-lg">
              <CheckCircle2 className="size-7" />
            </div>
            <div className="flex-1">
              <div className="display text-xl font-semibold">Delivered. Enjoy! 🎉</div>
              <div className="text-sm text-muted-foreground">Your order arrived at the door. Don't forget to tip your rider.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ───────────────────────── Feedback CTA ───────────────────────── */}
      {isDelivered && (
        <FeedbackCta
          hasFeedback={!!feedback}
          windowClosed={feedbackWindowClosed}
          onOpen={() => setFeedbackOpen(true)}
        />
      )}

      {/* ───────────────────────── Live ETA pill + Map ───────────────────────── */}
      {order.status === 'OUT_FOR_DELIVERY' && (
        <>
          {liveEta && (
            <div className="mb-3 flex justify-center">
              {liveEta.minutes <= 2 ? (
                // ≤2 min: swap to "rider is here" copy + a slow pulse so the
                // customer notices without us having to flash anything.
                <div className="inline-flex items-center gap-2 rounded-full bg-success text-success-foreground px-4 py-2 text-sm font-semibold shadow-lg shadow-success/30 pulse-soft">
                  <Bike className="size-4" />
                  Rider is here — please be ready
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-md shadow-primary/30">
                  <Clock className="size-4" />
                  Arriving in ~{liveEta.minutes} min · {liveEta.km < 1 ? `${Math.round(liveEta.km * 1000)} m` : `${liveEta.km.toFixed(1)} km`} away
                </div>
              )}
            </div>
          )}
          {/* Mobile: full-bleed map (no card frame). Desktop: framed in a card.
              Negative inset matches the container's px-4. */}
          <div className="md:hidden -mx-4 mb-6 border-y bg-card">
            <DeliveryMap
              orderId={order.id}
              branch={order.branch?.latitude != null && order.branch?.longitude != null
                ? { lat: order.branch.latitude, lng: order.branch.longitude }
                : null}
              delivery={dropPoint}
              initialRider={mapSeed?.rider ?? null}
              initialTrail={mapSeed?.trail ?? []}
            />
          </div>
          <Card className="hidden md:block mb-6 overflow-hidden">
            <CardContent className="p-3">
              <DeliveryMap
                orderId={order.id}
                branch={order.branch?.latitude != null && order.branch?.longitude != null
                  ? { lat: order.branch.latitude, lng: order.branch.longitude }
                  : null}
                delivery={dropPoint}
                initialRider={mapSeed?.rider ?? null}
                initialTrail={mapSeed?.trail ?? []}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* ───────────────────────── Body ───────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="card-lift">
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Items</h3>
            <ul className="space-y-2 text-sm">
              {order.items.map((i: any) => (
                <li key={i.id} className="flex justify-between">
                  <span>{i.quantity}× {i.name}</span>
                  <span className="font-medium">{money(Number(i.unitPrice) * i.quantity)}</span>
                </li>
              ))}
            </ul>
            <hr className="my-3" />
            <dl className="space-y-1 text-sm">
              <Row label="Subtotal" value={money(Number(order.subtotal))} />
              {Number(order.discountAmount) > 0 && <Row label="Discount" value={'−' + money(Number(order.discountAmount))} accent="text-success" />}
              {Number(order.walletApplied) > 0 && <Row label="Wallet" value={'−' + money(Number(order.walletApplied))} accent="text-success" />}
              {Number(order.loyaltyApplied) > 0 && <Row label="Loyalty" value={'−' + money(Number(order.loyaltyApplied))} accent="text-success" />}
              <Row label="Tax" value={money(Number(order.taxAmount))} />
              <Row label="Delivery" value={money(Number(order.deliveryFee))} />
              <div className="flex justify-between border-t pt-2 mt-2 text-base font-semibold">
                <span>Total</span><span className="text-primary">{money(Number(order.total))}</span>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {order.address && (
            <Card className="card-lift">
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><MapPin className="size-4 text-primary" /> Delivery to</h3>
                <p className="text-sm">{order.address.line1}{order.address.line2 ? `, ${order.address.line2}` : ''}, {order.address.city} {order.address.postalCode}</p>
              </CardContent>
            </Card>
          )}

          {order.assignment?.rider && order.status !== 'DELIVERED' && (
            <Card className="card-lift">
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Bike className="size-4 text-primary" /> Your rider</h3>
                <div className="text-sm">{order.assignment.rider.user.name}</div>
                <div className="text-xs text-muted-foreground">{order.assignment.rider.vehicleNumber}</div>
                <div className="mt-3 flex gap-2">
                  <a href={`tel:${order.assignment.rider.user.phone}`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent tap-press">
                    <Phone className="size-4" /> Call rider
                  </a>
                </div>
              </CardContent>
            </Card>
          )}

          {order.deliveryOtp && !isDelivered && !isTerminal && !order.deliveryOtpVerified && (
            <DeliveryOtpCard otp={order.deliveryOtp} status={order.status} />
          )}

          {isDelivered && order.assignment && <TipCard order={order} />}

          {isDelivered && (
            <Card className="card-lift">
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Loved it?</h3>
                <p className="text-sm text-muted-foreground mb-3">Rebuild this cart in one tap — same items, same restaurant.</p>
                <ReorderButton orderId={order.id} />
              </CardContent>
            </Card>
          )}

          {/* Desktop timeline — list inside a single card. */}
          <Card className="hidden md:block card-lift">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="size-4 text-primary" /> Timeline</h3>
              <ul className="space-y-2.5 text-sm">
                {order.statusEvents.map((e: any, i: number) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {STATUS_LABELS[e.status as keyof typeof STATUS_LABELS] ?? e.status}
                    </span>
                    <span className="text-muted-foreground text-xs font-mono">{new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Mobile timeline — each event is its own card in a single column.
              Reads as a real status feed, not a buried list. */}
          <div className="md:hidden space-y-2">
            <h3 className="font-semibold flex items-center gap-2 px-1 mb-2"><Clock className="size-4 text-primary" /> Timeline</h3>
            {order.statusEvents.map((e: any, i: number) => (
              <Card key={i} className="rounded-2xl">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="size-2 rounded-full bg-primary" />
                    {STATUS_LABELS[e.status as keyof typeof STATUS_LABELS] ?? e.status}
                  </span>
                  <span className="text-muted-foreground text-xs font-mono">
                    {new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {isDelivered && (
        <FeedbackDialog
          order={{ id: order.id, code: order.code, deliveredAt }}
          existing={feedback}
          readOnly={feedbackWindowClosed}
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          onSaved={async () => {
            // Refresh local copy so the CTA flips from "Share feedback" to
            // "Edit feedback" without a full page reload.
            try {
              const r = await fetch(`/api/customer/orders/${order.id}/feedback`);
              if (r.ok) {
                const d = await r.json();
                setFeedback(d.feedback ?? null);
              }
            } catch {}
          }}
        />
      )}
    </div>
  );
}

function FeedbackCta({ hasFeedback, windowClosed, onOpen }: { hasFeedback: boolean; windowClosed: boolean; onOpen: () => void }) {
  if (!hasFeedback && !windowClosed) {
    return (
      // Mobile: full-width gradient card with the CTA spanning the card width
      // below the copy. Desktop: side-by-side, button hugs the right edge.
      <Card className="mb-6 overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-warning/5 to-card card-lift rounded-2xl md:rounded-xl">
        <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 shrink-0">
              <Star className="size-6 fill-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">How was your order?</div>
              <div className="text-sm text-muted-foreground">Share feedback within 48h — it helps your kitchen and rider improve.</div>
            </div>
          </div>
          <Button onClick={onOpen} className="w-full md:w-auto h-11 md:h-10 md:ml-auto">
            <MessageSquarePlus className="size-4" /> Share feedback
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (hasFeedback && !windowClosed) {
    return (
      <Card className="mb-6 overflow-hidden border-success/30 bg-success/5">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="size-5 text-success" />
          <div className="flex-1 text-sm">
            <span className="font-medium">Thanks for the feedback!</span>
            <span className="text-muted-foreground"> You can still tweak it during the 48-hour window.</span>
          </div>
          <Button variant="outline" size="sm" onClick={onOpen}>
            <MessageSquareText className="size-4" /> Edit feedback
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (hasFeedback && windowClosed) {
    return (
      <Card className="mb-6 overflow-hidden">
        <CardContent className="p-4 flex items-center gap-3">
          <Lock className="size-5 text-muted-foreground" />
          <div className="flex-1 text-sm text-muted-foreground">Feedback closed (read-only)</div>
          <Button variant="ghost" size="sm" onClick={onOpen}>View</Button>
        </CardContent>
      </Card>
    );
  }
  return null;
}

const ICONS: any = { RECEIVED: CheckCircle2, ACCEPTED: CheckCircle2, PREPARING: ChefHat, READY: Package, OUT_FOR_DELIVERY: Bike, DELIVERED: CheckCircle2 };

function Stepper({ progression, idx }: { progression: readonly string[]; idx: number }) {
  const pct = idx < 0 ? 0 : (idx / (progression.length - 1)) * 100;
  return (
    <div className="relative">
      {/* Track + progress line */}
      <div className="absolute left-5 right-5 top-5 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary via-warning to-primary transition-all duration-700"
          style={{ width: `${pct}%`, backgroundSize: '200% 100%' }}
        />
      </div>
      <div className="relative grid grid-cols-5 gap-2">
        {progression.map((s, i) => (
          <Step key={s} done={i <= idx} active={i === idx} label={STATUS_LABELS[s as keyof typeof STATUS_LABELS]} icon={ICONS[s]} />
        ))}
      </div>
    </div>
  );
}

function Step({ done, active, label, icon: Icon }: { done: boolean; active: boolean; label: string; icon: any }) {
  return (
    <div className="flex flex-col items-center gap-1.5 relative">
      <div
        className={`grid h-10 w-10 place-items-center rounded-full transition-all duration-500 relative z-10 ${
          done ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30' : 'bg-card border-2 border-muted text-muted-foreground'
        } ${active ? 'ring-saffron scale-110' : ''}`}
      >
        <Icon className="size-5" />
        {active && (
          <span className="absolute inset-0 rounded-full bg-primary/30 pulse-soft" />
        )}
      </div>
      <div className={`text-[10px] md:text-[11px] text-center leading-tight ${done ? 'font-medium' : 'text-muted-foreground'}`}>{label}</div>
    </div>
  );
}

/**
 * Always-visible delivery OTP card. Two visual states:
 *  - Pre-OUT_FOR_DELIVERY: muted, informational ("save this for when your rider arrives")
 *  - OUT_FOR_DELIVERY: prominent, pulsing ("hand this code to your rider now")
 */
function DeliveryOtpCard({ otp, status }: { otp: string; status: string }) {
  const [copied, setCopied] = useState(false);
  const isHandoffNow = status === 'OUT_FOR_DELIVERY';

  async function copyOtp() {
    try {
      await navigator.clipboard.writeText(otp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Fallback for non-clipboard browsers — select and prompt
      window.prompt('Copy your delivery OTP', otp);
    }
  }

  const digits = otp.split('');

  return (
    <Card
      className={`card-lift overflow-hidden transition-all ${
        isHandoffNow
          ? 'border-2 border-primary bg-gradient-to-br from-primary/10 via-warning/5 to-card ring-saffron'
          : 'border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card'
      }`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-base">
              {isHandoffNow ? (
                <>
                  <span className="relative inline-flex">
                    <span className="size-2.5 rounded-full bg-primary" />
                    <span className="absolute inset-0 size-2.5 rounded-full bg-primary pulse-soft" />
                  </span>
                  Hand this code to your rider
                </>
              ) : (
                <>
                  <KeyRound className="size-4 text-primary" /> Your delivery code
                </>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {isHandoffNow
                ? 'Read it out only after your food is in hand. The rider enters it to close the order.'
                : 'Save this code — your rider will ask for it when they hand over your order.'}
            </p>
          </div>
          <button
            type="button"
            onClick={copyOtp}
            aria-label="Copy delivery OTP"
            className="shrink-0 inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary transition-colors tap-press"
          >
            {copied ? (<><CheckCircle2 className="size-3.5 text-success" /> Copied</>) : (<><Copy className="size-3.5" /> Copy</>)}
          </button>
        </div>

        {/* Big digit display — 4 boxed digits, monospaced */}
        <div className={`mt-4 flex gap-2 ${isHandoffNow ? '' : ''}`}>
          {digits.map((d, i) => (
            <div
              key={i}
              className={`flex-1 aspect-[3/4] grid place-items-center rounded-xl font-mono font-bold text-3xl md:text-4xl tracking-tighter transition-all ${
                isHandoffNow
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                  : 'bg-card border-2 border-primary/20 text-primary'
              }`}
              style={isHandoffNow ? { animationDelay: `${i * 100}ms` } : undefined}
            >
              {d}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success shrink-0" />
          <span>{isHandoffNow ? 'Never share until your food is at the door.' : `You'll be prompted again when the rider is at your door.`}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd className={accent}>{value}</dd></div>;
}

function TipCard({ order }: { order: any }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number>(Number(order.assignment?.tipAmt ?? 0));
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const presets = [20, 50, 100];

  async function tip(amount: number) {
    if (!amount || amount < 1) return;
    setBusy(true);
    setSelected(amount);
    const r = await fetch(`/api/orders/${order.id}/tip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) });
    setBusy(false);
    if (!r.ok) {
      setSelected(null);
      return import('sonner').then((m) => m.toast.error('Tip failed'));
    }
    setSent(amount);
    import('sonner').then((m) => m.toast.success(`₹${amount} tip sent to ${order.assignment.rider?.user?.name ?? 'the rider'} ❤️`));
  }

  const done = sent > 0;
  const riderName = order.assignment?.rider?.user?.name?.split(' ')[0] ?? 'your rider';

  return (
    <Card className={`card-lift overflow-hidden ${done ? 'border-success/40 bg-gradient-to-br from-success/5 to-card' : 'border-warning/30 bg-gradient-to-br from-warning/5 via-card to-primary/5'}`}>
      <CardContent className="p-5">
        <h3 className="font-semibold flex items-center gap-2">
          <Heart className={`size-4 ${done ? 'fill-success text-success' : 'text-primary'} ${done ? 'burst' : ''}`} />
          {done ? `Thanks for tipping ${riderName}!` : 'Tip your rider'}
        </h3>

        {order.assignment?.deliveryPhotoUrl && (
          <div className="mt-3 overflow-hidden rounded-xl border">
            <img src={order.assignment.deliveryPhotoUrl} alt="Delivery proof" className="w-full h-40 object-cover" />
            <p className="text-xs text-muted-foreground p-2 bg-card">📸 Photo taken by {order.assignment.rider?.user?.name ?? 'rider'} at handoff</p>
          </div>
        )}

        {done ? (
          <div className="mt-3 rounded-xl bg-success/10 p-3 text-sm text-success flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>₹{sent} delivered. 100% goes to {riderName} — no commission taken.</span>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">100% goes to the rider. No commission taken.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  disabled={busy}
                  onClick={() => tip(p)}
                  className={`relative rounded-xl border-2 px-3 py-3 text-base font-semibold transition-all tap-press ${
                    selected === p
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:border-primary hover:bg-primary/5 hover:text-primary'
                  } disabled:opacity-50`}
                >
                  ₹{p}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="number" min={1} placeholder="Custom amount" value={custom} onChange={(e) => setCustom(e.target.value)}
                className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:border-primary"
              />
              <Button disabled={busy || !custom} onClick={() => tip(Number(custom))} className="px-5">
                <Heart className="size-4" /> Send
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* Confetti burst on DELIVERED — 24 colored pieces falling once */
function Confetti() {
  const colors = ['#ea5b1f', '#f8a04a', '#16a34a', '#3a73c1', '#d97706'];
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    i,
    left: Math.random() * 100,
    dx: (Math.random() - 0.5) * 240,
    delay: Math.random() * 300,
    color: colors[i % colors.length],
    rot: Math.random() * 360
  }));
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            top: '-10vh',
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            animationDelay: `${p.delay}ms`,
            // @ts-expect-error CSS custom property
            '--dx': `${p.dx}px`
          }}
        />
      ))}
    </div>
  );
}
