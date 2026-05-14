'use client';
import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Phone, Navigation, MapPin, Check, Bike, Package, Store, DoorOpen,
  AlertTriangle, X, PhoneOff, MapPinOff, HelpCircle, Route, Map as MapIcon,
  ChevronDown, Clock, KeyRound, TrendingUp, Camera
} from 'lucide-react';
import { money } from '@/lib/utils';
import { useSSE } from '@/hooks/use-sse';
import { toast } from 'sonner';
import RiderMap from './rider-map';

// Haversine km — used to compute pickup/drop ETAs on the assignment card.
// Server-side proximity also runs in metres; we keep km here because the
// rider screen displays km/min.
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

// Best-effort speak — silently no-ops if speechSynthesis is unavailable.
function speak(text: string) {
  if (typeof window === 'undefined') return;
  try {
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* swallowed — voice is a nice-to-have */
  }
}

// CancellationReason options the rider is allowed to file. FRAUD_SUSPECTED is
// admin-only — riders shouldn't be the ones flagging fraud from the doorstep.
const RIDER_FAIL_REASONS: { value: string; label: string }[] = [
  { value: 'CUSTOMER_WRONG_ADDRESS',    label: 'Wrong address' },
  { value: 'CUSTOMER_UNREACHABLE',      label: 'Customer unreachable' },
  { value: 'CUSTOMER_CHANGED_MIND',     label: 'Customer changed mind / refused' },
  { value: 'RIDER_VEHICLE_ISSUE',       label: 'Vehicle issue' },
  { value: 'RIDER_PERSONAL_EMERGENCY',  label: 'Personal emergency' },
  { value: 'OTHER',                     label: 'Other' }
];

export function RiderActiveBoard({
  rider,
  assignments: initial,
  todaysTripCount = 0,
  todaysEarnings = 0
}: {
  rider: any;
  assignments: any[];
  todaysTripCount?: number;
  todaysEarnings?: number;
}) {
  const [assignments, setAssignments] = useState<any[]>(initial);
  const [online, setOnline] = useState<boolean>(rider.isOnline);
  // Live rider GPS — surfaced to children so the assignment card can render
  // "Pickup in ~Xmin" / "Drop in ~Xmin" and the Open-in-Maps button can pass
  // an explicit origin to Google.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);

  // Stream GPS to server while online. We push every position fix the device
  // emits — the server publishes to all SSE subscribers in the same tick.
  // A tiny client-side floor (200ms) prevents the browser from spamming on
  // bursts; the DB write is separately throttled to ~3s server-side.
  useEffect(() => {
    if (!online || typeof window === 'undefined' || !navigator.geolocation) return;
    let lastSentAt = 0;
    let lastLat = NaN, lastLng = NaN;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const same = Math.abs(pos.coords.latitude - lastLat) < 1e-6 && Math.abs(pos.coords.longitude - lastLng) < 1e-6;
        if (now - lastSentAt < 200) return; // floor: 5 pings/sec max
        if (same && now - lastSentAt < 1500) return; // skip identical fixes faster than 1.5s
        lastSentAt = now;
        lastLat = pos.coords.latitude; lastLng = pos.coords.longitude;
        // Mirror the latest fix into React state — used by the assignment card
        // ETA + the "Open in Maps" button. The send-to-server path below is
        // unchanged.
        setRiderPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const orderId = assignments.find((a) => a.status === 'PICKED_UP')?.orderId;
        fetch('/api/rider/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // keepalive so the request still completes if the page is backgrounded mid-flight
          keepalive: true,
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, speedKph: pos.coords.speed ? pos.coords.speed * 3.6 : undefined, orderId })
        }).catch(() => {});
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online, assignments]);

  // Liveness heartbeat — every 30s while online, tell the server we're alive
  // so the auto-offline sweep doesn't flip us to offline. `keepalive` lets the
  // ping survive a backgrounded tab. We send a beat immediately on toggle-on
  // so a fresh shift shows green without waiting 30s.
  useEffect(() => {
    if (!online || typeof window === 'undefined') return;
    const ping = () => {
      fetch('/api/rider/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          gpsEnabled: !!navigator.geolocation,
          appVersion: '1.0.0'
        })
      }).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, 30_000);
    return () => clearInterval(timer);
  }, [online]);

  useSSE(`rider:${rider.id}`, {
    onMessage: async (e: any) => {
      if (e.kind === 'assigned') {
        toast.info('New delivery assigned');
        const r = await fetch(`/api/rider/assignments`);
        if (r.ok) setAssignments(await r.json());
      }
    }
  });

  async function setOnlineStatus(v: boolean) {
    setOnline(v);
    await fetch('/api/rider/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ online: v }) });
  }

  return (
    <div className="space-y-4">
      {/* ─── Compact status strip (replaces the old hero card + Today grid) ───
          One row, three pills: online toggle, trips today, earnings today.
          Caps at ~56px so the assignment card sits above the fold on 380x844. */}
      <StatusStrip
        online={online}
        onToggle={setOnlineStatus}
        trips={todaysTripCount}
        earned={todaysEarnings}
      />

      {/* ─── Empty state with preview map ─── */}
      {assignments.length === 0 && <EmptyState online={online} />}

      {/* ─── Active assignment cards ─── */}
      {assignments.map((a) => <AssignmentCard key={a.id} assignment={a} riderPos={riderPos} onChange={async () => {
        const r = await fetch('/api/rider/assignments');
        if (r.ok) setAssignments(await r.json());
      }} />)}
    </div>
  );
}

/**
 * Compact one-row status strip. Replaces the chunky "You're online" hero +
 * the separate Today / Earned grid that used to live in `page.tsx`. All
 * three signals fit on one 56px-tall row so the assignment card immediately
 * follows below — critical on 380×844 Capacitor WebViews where every pixel
 * pushes the map closer to (or under) the fold.
 */
function StatusStrip({
  online,
  onToggle,
  trips,
  earned
}: {
  online: boolean;
  onToggle: (v: boolean) => void;
  trips: number;
  earned: number;
}) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 h-14">
        {/* Online pill — green pulsing dot when on, neutral otherwise. The
            Switch sits inline so the rider toggles without leaving the row. */}
        <div className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${online ? 'border-success/40 bg-success/10' : 'border-border bg-muted/40'}`}>
          <span className="relative inline-flex shrink-0">
            <span className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground/50'}`} />
            {online && <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />}
          </span>
          <span className={`text-xs font-semibold ${online ? 'text-success' : 'text-muted-foreground'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
          <Switch checked={online} onCheckedChange={onToggle} className="scale-75 -mr-1" />
        </div>

        {/* Trips pill */}
        <div className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1">
          <Bike className="size-3.5 text-primary" />
          <span className="text-xs font-semibold tabular-nums">{trips}</span>
          <span className="text-[11px] text-muted-foreground">{trips === 1 ? 'trip' : 'trips'}</span>
        </div>

        {/* Earnings pill — saffron tint to draw the eye to the money line. */}
        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1">
          <TrendingUp className="size-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary tabular-nums">{money(earned)}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ online }: { online: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Radar-style header */}
        <div className="relative h-40 bg-gradient-to-br from-primary/10 via-warning/5 to-success/10 grid place-items-center overflow-hidden">
          {/* Concentric rings */}
          <div className="absolute size-32 rounded-full border-2 border-primary/20 pulse-soft" />
          <div className="absolute size-48 rounded-full border-2 border-primary/15 pulse-soft" style={{ animationDelay: '0.5s' }} />
          <div className="absolute size-64 rounded-full border-2 border-primary/10 pulse-soft" style={{ animationDelay: '1s' }} />
          <div className="relative grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-xl ring-saffron">
            <Bike className="size-8 float-soft" />
          </div>
        </div>
        <div className="p-5 text-center">
          <div className="font-semibold text-base">
            {online ? 'Waiting for your next delivery…' : 'Go online to start receiving orders'}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {online
              ? "When a restaurant releases an order, it'll appear in the Pool tab. Claim it to start the ride."
              : "Flip the switch above — new deliveries near you will show up here automatically."}
          </p>
          {online && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs">
              <Stat label="GPS" value="Active" tone="success" />
              <Stat label="Pool" value="Listening" tone="primary" />
              <Stat label="Today" value="0 trips" tone="muted" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'primary' | 'muted' }) {
  const cls = tone === 'success' ? 'bg-success/10 text-success border-success/30'
            : tone === 'primary' ? 'bg-primary/10 text-primary border-primary/30'
            : 'bg-muted text-muted-foreground border-border';
  return (
    <div className={`rounded-full border px-3 py-1 ${cls}`}>
      <span className="font-medium">{value}</span>
      <span className="opacity-60 ml-1">{label}</span>
    </div>
  );
}

/**
 * Top-of-card status banner. Full-width coloured strip, sits flush against
 * the card's top edge (parent uses overflow-hidden + rounded-2xl). Colour
 * varies by stage:
 *   - PENDING   → warning (saffron-amber, "awaiting acceptance")
 *   - ACCEPTED  → saffron primary (heading to pickup)
 *   - PICKED_UP → success green (en route to customer)
 * Big text (`text-base`) + icon → this is the visual anchor of the card.
 */
function StatusBanner({ status }: { status: string }) {
  const cfg = status === 'PENDING'
    ? { label: 'Awaiting acceptance',         sub: 'Tap to claim this delivery', Icon: AlertTriangle, cls: 'bg-warning text-warning-foreground' }
    : status === 'ACCEPTED'
    ? { label: 'En route to pickup',          sub: 'Head to the restaurant',     Icon: Store,         cls: 'bg-primary text-primary-foreground' }
    : status === 'PICKED_UP'
    ? { label: 'Picked up · heading to customer', sub: 'Drop next',              Icon: Bike,          cls: 'bg-success text-success-foreground' }
    : { label: status,                        sub: '',                            Icon: Package,       cls: 'bg-muted text-muted-foreground' };
  const { Icon } = cfg;
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${cfg.cls}`}>
      <div className="grid size-9 place-items-center rounded-xl bg-black/15 shrink-0">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold leading-tight truncate">{cfg.label}</div>
        {cfg.sub && <div className="text-[11px] opacity-90 leading-tight truncate">{cfg.sub}</div>}
      </div>
    </div>
  );
}

function AssignmentCard({ assignment: a, riderPos: livePos, onChange }: { assignment: any; riderPos?: { lat: number; lng: number } | null; onChange: () => void }) {
  const [otp, setOtp] = useState('');
  // OTP entry mode: PICKED_UP starts as "action" (big primary button), once
  // the rider taps it we flip to "otp" and reveal the 4-digit input.
  const [otpMode, setOtpMode] = useState(false);
  // Track OTP failures locally — server is source of truth, but rider UX
  // wants instant feedback after the 3rd and 5th miss.
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [cantDeliverOpen, setCantDeliverOpen] = useState(false);
  // Collapsibles — address landmark + items list. Both default closed so the
  // card stays short and the map dominates.
  const [addressOpen, setAddressOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Cache rider's last-known position so "Get directions" can include an
  // explicit origin. Seeded from the live watchPosition prop when available.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(livePos ?? null);
  // Watch for stage flips so we can speak a confirmation cue.
  const prevStatusRef = useRef<string>(a.status);
  const o = a.order;

  // Keep local cache in sync with the live geolocation feed from the parent.
  useEffect(() => {
    if (livePos) setRiderPos(livePos);
  }, [livePos]);

  // Voice cue on automatic ACCEPTED → PICKED_UP transition.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === 'ACCEPTED' && a.status === 'PICKED_UP') {
      speak('Pickup confirmed');
    }
    prevStatusRef.current = a.status;
  }, [a.status]);

  // Active navigation target: branch before pickup, customer address after.
  const targetPoint: { lat: number; lng: number } | null =
    a.status === 'ACCEPTED' && o.branch?.latitude != null && o.branch?.longitude != null
      ? { lat: o.branch.latitude, lng: o.branch.longitude }
      : o.address?.latitude != null && o.address?.longitude != null
        ? { lat: o.address.latitude, lng: o.address.longitude }
        : null;

  // Inline ETA pill — uses the live GPS prop. Returns null off-stage.
  const legEta = (() => {
    if (!riderPos || !targetPoint) return null;
    if (a.status !== 'ACCEPTED' && a.status !== 'PICKED_UP') return null;
    const km = haversineKm(riderPos, targetPoint);
    const minutes = Math.max(1, Math.round((km / 25) * 60));
    const distance = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
    return { minutes, distance };
  })();

  // "Open in Maps" — full driving route URL. Falls back to destination-only
  // when GPS isn't ready (Google then asks the device for an origin).
  const openInMapsUrl = (() => {
    if (!targetPoint) return null;
    const dest = `${targetPoint.lat},${targetPoint.lng}`;
    const base = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
    return riderPos ? `${base}&origin=${riderPos.lat},${riderPos.lng}` : base;
  })();

  // Plain destination param — coords preferred, free-text fallback.
  const destParam = targetPoint
    ? `${targetPoint.lat},${targetPoint.lng}`
    : encodeURIComponent(`${o.address?.line1 ?? ''} ${o.address?.city ?? ''}`.trim());

  // "Get directions" — same as Open in Maps but resolves the rider's origin
  // lazily on tap when livePos hasn't arrived yet. Pops a blank tab inside
  // the click handler so popup blockers stay friendly.
  function openDirections() {
    const buildUrl = (origin?: { lat: number; lng: number }) => {
      const base = `https://www.google.com/maps/dir/?api=1&destination=${destParam}&travelmode=driving`;
      return origin ? `${base}&origin=${origin.lat},${origin.lng}` : base;
    };
    if (riderPos) {
      window.open(buildUrl(riderPos), '_blank', 'noreferrer');
      return;
    }
    if (typeof window === 'undefined' || !navigator.geolocation) {
      window.open(buildUrl(), '_blank', 'noreferrer');
      return;
    }
    const pending = window.open('about:blank', '_blank');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRiderPos(here);
        if (pending) pending.location.href = buildUrl(here);
        else window.open(buildUrl(here), '_blank', 'noreferrer');
      },
      () => {
        if (pending) pending.location.href = buildUrl();
        else window.open(buildUrl(), '_blank', 'noreferrer');
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 }
    );
  }

  const reachedCustomer = o.status === 'RIDER_REACHED_CUSTOMER' || o.status === 'DELIVERY_OTP_FAILED' || o.status === 'CUSTOMER_UNREACHABLE';
  const otpDisabled = otpAttempts >= 5;
  const itemCount = o.items.length;
  const itemTotal = o.items.reduce((acc: number, i: any) => acc + (i.quantity ?? 1), 0);

  // Customer initials for the avatar circle. Fall back to "?" if absent.
  const initials = (() => {
    const name = (o.customer?.name ?? '').trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((p: string) => p[0]?.toUpperCase() ?? '').join('') || '?';
  })();

  async function submitOtp() {
    setSubmittingOtp(true);
    try {
      const r = await fetch(`/api/rider/assignments/${a.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp })
      });
      if (!r.ok) {
        setOtpAttempts((n) => n + 1);
        setOtp('');
        toast.error('Invalid OTP');
        return;
      }
      toast.success('Delivered!');
      onChange();
    } finally {
      setSubmittingOtp(false);
    }
  }

  return (
    <Card className="overflow-hidden rounded-2xl border bg-card shadow-sm card-lift">
      {/* No CardContent padding — banner sits flush at the top. */}
      <div className="reveal-stagger">
        {/* 1) Status banner — full-bleed, the strongest signal on the card. */}
        <StatusBanner status={a.status} />

        {/* 2) Order code + total row. Monospace code left, money right. */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <div className="font-mono font-semibold text-sm truncate">{o.code}</div>
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="font-semibold text-base text-primary tabular-nums">{money(o.total)}</span>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{o.paymentMethod}</span>
          </div>
        </div>

        {/* 3) Customer card — compact 56px tall. Avatar + name/phone + Call. */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-2 h-14">
            <div className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary font-semibold text-sm shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate leading-tight">{o.customer?.name ?? 'Customer'}</div>
              {o.customer?.phone && (
                <div className="text-[11px] text-muted-foreground tabular-nums truncate leading-tight">{o.customer.phone}</div>
              )}
            </div>
            {o.customer?.phone && (
              <a
                href={`tel:${o.customer.phone}`}
                className="tap-press inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 h-10 text-sm font-semibold shadow-sm shrink-0"
                aria-label={`Call ${o.customer?.name ?? 'customer'}`}
              >
                <Phone className="size-4" /> Call
              </a>
            )}
          </div>
        </div>

        {/* 4) Address row — one line, truncate. Tap expands landmark/full text. */}
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => setAddressOpen((v) => !v)}
            className="tap-press w-full flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2 text-left"
            aria-expanded={addressOpen}
          >
            <MapPin className="size-4 text-primary shrink-0" />
            <span className="text-xs truncate flex-1">
              {o.address?.line1}{o.address?.city ? `, ${o.address.city}` : ''}
            </span>
            <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${addressOpen ? 'rotate-180' : ''}`} />
          </button>
          {addressOpen && (
            <div className="mt-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed space-y-0.5">
              <div>{o.address?.line1}</div>
              {o.address?.line2 && <div>{o.address.line2}</div>}
              <div>
                {o.address?.city}
                {o.address?.state ? `, ${o.address.state}` : ''}
                {o.address?.postalCode ? ` ${o.address.postalCode}` : ''}
              </div>
              {o.address?.landmark && (
                <div className="pt-1 text-foreground">
                  <span className="font-medium">Landmark:</span> {o.address.landmark}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 5) MAP — the centerpiece. Wrapped so we can float the ETA pill on top.
            RiderMapInner is the other agent's component; we just give it a
            sized container. The 4:3 aspect ratio keeps the map dominant on
            380×844 while ensuring the secondary buttons still fit. */}
        <div className="px-4 pt-3">
          <div className="relative overflow-hidden rounded-xl border">
            <RiderMap
              branch={o.branch?.latitude != null && o.branch?.longitude != null
                ? { lat: o.branch.latitude, lng: o.branch.longitude } : null}
              delivery={o.address?.latitude != null && o.address?.longitude != null
                ? { lat: o.address.latitude, lng: o.address.longitude } : null}
              stage={a.status}
            />
            {/* Floating live ETA pill — top-right of the map, updates per GPS tick. */}
            {legEta && (
              <div className="pointer-events-none absolute top-2 right-2 z-[400] inline-flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur border border-primary/40 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-md">
                <Clock className="size-3" />
                {legEta.minutes} min · {legEta.distance}
              </div>
            )}
          </div>
        </div>

        {/* 6) Items strip — collapsible. Default shows count + total qty. */}
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => setItemsOpen((v) => !v)}
            className="tap-press w-full flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2 text-left"
            aria-expanded={itemsOpen}
          >
            <Package className="size-4 text-muted-foreground shrink-0" />
            <span className="text-xs flex-1">
              <span className="font-medium">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
              <span className="text-muted-foreground"> · {itemTotal} pcs</span>
            </span>
            <span className="text-xs font-semibold text-primary tabular-nums">{money(o.total)}</span>
            <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${itemsOpen ? 'rotate-180' : ''}`} />
          </button>
          {itemsOpen && (
            <ul className="mt-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-1">
              {o.items.map((i: any) => (
                <li key={i.id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    <span className="font-medium text-foreground">{i.quantity}×</span> {i.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 7) Primary action — shifts label/icon by stage. Full-width, 56px. */}
        <div className="px-4 pt-3 space-y-2">
          <PrimaryAction
            assignment={a}
            otpMode={otpMode}
            setOtpMode={setOtpMode}
            otp={otp}
            setOtp={setOtp}
            otpAttempts={otpAttempts}
            otpDisabled={otpDisabled}
            submittingOtp={submittingOtp}
            submitOtp={submitOtp}
            reachedCustomer={reachedCustomer}
            onChange={onChange}
            customerName={o.customer?.name}
          />

          {/* 8) Secondary action row — Open in Maps + Get directions. Call is
              already in the customer card above, so we don't duplicate it. */}
          <div className="grid grid-cols-2 gap-2">
            {openInMapsUrl ? (
              <Button asChild variant="outline" size="sm" className="tap-press h-11">
                <a href={openInMapsUrl} target="_blank" rel="noreferrer" aria-label="Open route in Google Maps">
                  <MapIcon className="size-4" /> Open in Maps
                </a>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="tap-press h-11" disabled>
                <MapIcon className="size-4" /> Open in Maps
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tap-press h-11"
              onClick={openDirections}
            >
              <Route className="size-4" /> Directions
            </Button>
          </div>

          {/* Photo upload — collapsible, only relevant after pickup. Tucked
              into a chevron-expandable strip so it doesn't compete with OTP. */}
          {a.status === 'PICKED_UP' && (
            <div>
              <button
                type="button"
                onClick={() => setPhotoOpen((v) => !v)}
                className="tap-press w-full flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2 text-left"
                aria-expanded={photoOpen}
              >
                <Camera className="size-4 text-muted-foreground shrink-0" />
                <span className="text-xs flex-1">
                  {a.deliveryPhotoUrl ? 'Photo uploaded' : 'Add proof-of-delivery photo'}
                </span>
                <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${photoOpen ? 'rotate-180' : ''}`} />
              </button>
              {photoOpen && (
                <label className="mt-1.5 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-muted/30 px-3 py-3 cursor-pointer hover:bg-accent tap-press text-xs">
                  <Camera className="size-4" />
                  <span>{a.deliveryPhotoUrl ? 'Replace photo' : 'Take or upload photo'}</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const fd = new FormData(); fd.append('photo', f);
                    const r = await fetch(`/api/rider/assignments/${a.id}/photo`, { method: 'POST', body: fd });
                    if (!r.ok) return toast.error('Upload failed');
                    toast.success('Photo uploaded');
                    onChange();
                  }} />
                </label>
              )}
            </div>
          )}

          {/* 9) Tertiary — text-only "Report issue". Always available once
              the order is active. Subtle until something goes wrong. */}
          {a.status !== 'PENDING' && (
            <button
              type="button"
              onClick={() => setCantDeliverOpen(true)}
              className="w-full text-center text-xs font-medium text-muted-foreground hover:text-destructive underline-offset-2 hover:underline tap-press py-2"
            >
              Report issue
            </button>
          )}
        </div>

        {/* Bottom inset — keeps the last button off the home indicator. */}
        <div className="h-3" />
      </div>

      <CantDeliverSheet
        open={cantDeliverOpen}
        onOpenChange={setCantDeliverOpen}
        assignmentId={a.id}
        onResolved={() => { setCantDeliverOpen(false); onChange(); }}
      />
    </Card>
  );
}

/**
 * Stage-driven primary action. Renders as a single 56px full-width button
 * for PENDING/ACCEPTED, and as either a big "Enter delivery OTP" button or
 * the actual OTP form for PICKED_UP. Keeps the AssignmentCard render tidy.
 */
function PrimaryAction({
  assignment: a,
  otpMode,
  setOtpMode,
  otp,
  setOtp,
  otpAttempts,
  otpDisabled,
  submittingOtp,
  submitOtp,
  reachedCustomer,
  onChange,
  customerName
}: {
  assignment: any;
  otpMode: boolean;
  setOtpMode: (v: boolean) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpAttempts: number;
  otpDisabled: boolean;
  submittingOtp: boolean;
  submitOtp: () => Promise<void>;
  reachedCustomer: boolean;
  onChange: () => void;
  customerName?: string;
}) {
  if (a.status === 'PENDING') {
    return (
      <Button
        size="lg"
        className="tap-press w-full h-14 text-base font-semibold"
        onClick={async () => {
          await fetch(`/api/rider/assignments/${a.id}/accept`, { method: 'POST' });
          onChange();
        }}
      >
        <Check className="size-5" /> Accept delivery
      </Button>
    );
  }

  if (a.status === 'ACCEPTED') {
    // Two stacked actions in a vertical group — primary "Mark picked up",
    // outline "I'm at the restaurant" as a step-up indicator below.
    return (
      <div className="space-y-2">
        <Button
          size="lg"
          className="tap-press w-full h-14 text-base font-semibold"
          onClick={async () => {
            const r = await fetch(`/api/rider/assignments/${a.id}/pickup`, { method: 'POST' });
            if (r.ok) {
              speak(`Order picked up. Heading to ${customerName ?? 'customer'}`);
            }
            onChange();
          }}
        >
          <Package className="size-5" /> Mark picked up
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tap-press w-full h-11"
          onClick={async () => {
            const r = await fetch(`/api/rider/assignments/${a.id}/reach-restaurant`, { method: 'POST' });
            if (!r.ok) return toast.error('Could not update');
            toast.success("Marked as at restaurant");
            onChange();
          }}
        >
          <Store className="size-4" /> I&apos;m at the restaurant
        </Button>
      </div>
    );
  }

  if (a.status === 'PICKED_UP') {
    // Pre-OTP: show the big "Enter delivery OTP" CTA. Once tapped, swap to
    // the actual OTP form. Keeps the at-rest state simple.
    if (!otpMode) {
      return (
        <div className="space-y-2">
          <Button
            size="lg"
            className="tap-press w-full h-14 text-base font-semibold"
            onClick={() => setOtpMode(true)}
          >
            <KeyRound className="size-5" /> Enter delivery OTP
          </Button>
          {!reachedCustomer && (
            <Button
              size="sm"
              variant="outline"
              className="tap-press w-full h-11"
              onClick={async () => {
                const r = await fetch(`/api/rider/assignments/${a.id}/reach-customer`, { method: 'POST' });
                if (!r.ok) return toast.error('Could not update');
                toast.success("Marked as at customer's door");
                onChange();
              }}
            >
              <DoorOpen className="size-4" /> I&apos;m at the customer&apos;s door
            </Button>
          )}
        </div>
      );
    }
    // OTP form mode — input + submit, plus soft/hard warnings on retries.
    return (
      <div className="space-y-2 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
          <KeyRound className="size-3.5" /> Delivery OTP
        </div>
        {otpAttempts >= 3 && otpAttempts < 5 && (
          <div className="flex items-start gap-2 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning" />
            <span>OTP entered wrong {otpAttempts} times. Try once more, or report a customer issue.</span>
          </div>
        )}
        {otpDisabled && (
          <div className="flex items-start gap-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>OTP locked after 5 failed attempts. Use &quot;Report issue&quot; below.</span>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="4-digit OTP"
            value={otp}
            disabled={otpDisabled}
            onChange={(e) => setOtp(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            className="font-mono text-base tracking-widest h-12"
            autoFocus
          />
          <Button
            size="lg"
            className="tap-press h-12"
            disabled={otpDisabled || submittingOtp || otp.length < 4}
            onClick={submitOtp}
          >
            <Check className="size-4" /> Mark delivered
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setOtpMode(false)}
          className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground tap-press py-1"
        >
          Hide OTP entry
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Bottom-sheet shown when the rider taps "Report issue". Mirrors the
 * rider account menu's slide-from-bottom Radix sheet for visual continuity.
 */
function CantDeliverSheet({
  open,
  onOpenChange,
  assignmentId,
  onResolved
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assignmentId: string;
  onResolved: () => void;
}) {
  const [view, setView] = useState<'menu' | 'other' | 'confirm-wrong-address'>('menu');
  const [reason, setReason] = useState<string>('OTHER');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset to root view whenever the sheet is closed externally.
  useEffect(() => {
    if (!open) {
      setView('menu');
      setReason('OTHER');
      setNote('');
    }
  }, [open]);

  async function reportUnreachable() {
    setBusy(true);
    try {
      const r = await fetch(`/api/rider/assignments/${assignmentId}/customer-unreachable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || undefined })
      });
      if (!r.ok) return toast.error('Could not report');
      toast.success('Admin notified. Standing by for further instructions.');
      onResolved();
    } finally { setBusy(false); }
  }

  async function reportFail(failReason: string, failNote?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/rider/assignments/${assignmentId}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: failReason, note: failNote })
      });
      if (!r.ok) return toast.error('Could not report');
      toast.success('Delivery marked as failed.');
      onResolved();
    } finally { setBusy(false); }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 bg-card rounded-t-3xl shadow-2xl border-t outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom max-w-md mx-auto"
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-muted" />
          </div>

          <div className="px-5 pb-2 flex items-start justify-between">
            <div>
              <DialogPrimitive.Title className="display text-xl font-semibold">Can&apos;t deliver?</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground">Tell us what&apos;s going on. Admin will be notified.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="px-5 py-4 space-y-3">
            {view === 'menu' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={reportUnreachable}
                  className="w-full flex items-center gap-3 rounded-xl border-2 border-warning/40 bg-warning/5 p-4 hover:bg-warning/10 transition-colors tap-press text-left"
                >
                  <div className="grid size-10 place-items-center rounded-lg bg-warning/15 text-warning shrink-0"><PhoneOff className="size-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Customer not answering</div>
                    <div className="text-[11px] text-muted-foreground">Notify admin — don&apos;t cancel yet</div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setView('confirm-wrong-address')}
                  className="w-full flex items-center gap-3 rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4 hover:bg-destructive/10 transition-colors tap-press text-left"
                >
                  <div className="grid size-10 place-items-center rounded-lg bg-destructive/15 text-destructive shrink-0"><MapPinOff className="size-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-destructive">Wrong address</div>
                    <div className="text-[11px] text-muted-foreground">Marks delivery as failed</div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setView('other')}
                  className="w-full flex items-center gap-3 rounded-xl border-2 border-border bg-card p-4 hover:bg-accent transition-colors tap-press text-left"
                >
                  <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground shrink-0"><HelpCircle className="size-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Other issue</div>
                    <div className="text-[11px] text-muted-foreground">Pick a reason and add a note</div>
                  </div>
                </button>
              </>
            )}

            {view === 'confirm-wrong-address' && (
              <div className="space-y-3">
                <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <div className="font-semibold text-destructive mb-1">Confirm: wrong address</div>
                  <p className="text-xs text-muted-foreground">
                    This will fail the delivery and start a refund if payment was already taken.
                    Make sure you&apos;ve called the customer first.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 tap-press" onClick={() => setView('menu')} disabled={busy}>Back</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 tap-press"
                    disabled={busy}
                    onClick={() => reportFail('CUSTOMER_WRONG_ADDRESS')}
                  >
                    Fail delivery
                  </Button>
                </div>
              </div>
            )}

            {view === 'other' && (
              <div className="space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">Reason</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {RIDER_FAIL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>

                <label className="block text-xs font-medium text-muted-foreground">Add a note (optional)</label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="What happened? Any context for admin?"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />

                <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-3 text-[11px] text-muted-foreground">
                  Confirming will mark the delivery as failed. A refund will be queued automatically if payment was captured.
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 tap-press" onClick={() => setView('menu')} disabled={busy}>Back</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 tap-press"
                    disabled={busy}
                    onClick={() => reportFail(reason, note || undefined)}
                  >
                    Confirm &amp; fail delivery
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="h-[env(safe-area-inset-bottom)]" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
