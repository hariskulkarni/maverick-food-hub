'use client';
/**
 * Rider account menu — tapping the avatar opens a sheet that shows phone,
 * online status, and a large Sign out button (44pt tap target, mobile-friendly).
 *
 * Sign out is robust to Capacitor WebView quirks:
 *   1. Call NextAuth signOut() with redirect:false (don't trust the redirect)
 *   2. Then explicitly hard-navigate to /login
 *   3. If signOut() errors silently (CSRF/cookie issues), the navigation still
 *      lands on the login screen, which itself runs an auth check and clears
 *      stale session cookies
 */
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { LogOut, Phone, ShieldCheck, X, Bike, User, ChevronRight, Wifi, WifiOff, MapPin, BadgeCheck, Star } from 'lucide-react';

interface Props {
  name: string;
  phone: string | null;
  email: string | null;
}

export function AccountMenu({ name, phone, email }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Heartbeat status — last GPS ping age, refreshed once when the sheet opens
  // and every 10s while it's open. Cheap fetch of `/api/rider/me` returns
  // online + lastSeenAt for the signed-in rider.
  const [hb, setHb] = useState<{ online: boolean; lastSeenAt: string | null } | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch('/api/rider/me', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        setHb({ online: !!j.online, lastSeenAt: j.lastSeenAt ?? null });
      } catch { /* offline / fetch error — leave stale */ }
    }
    pull();
    const refresh = setInterval(pull, 10_000);
    const tick = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => { cancelled = true; clearInterval(refresh); clearInterval(tick); };
  }, [open]);

  const pingAgeLabel = formatPingAge(hb?.lastSeenAt, nowTick);
  const online = !!hb?.online;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut({ redirect: false }).catch(() => {});
    } finally {
      // Hard navigate even if signOut threw — clears any stale session client-side.
      window.location.href = '/login?mode=rider';
    }
  }

  const initials = (name || phone || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <>
      {/* Trigger — avatar button. Large tap area (40×40). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account menu"
        className="ml-auto inline-flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-sm shadow-sm hover:bg-primary/25 transition-colors tap-press"
      >
        {initials}
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-50 bg-card rounded-t-3xl shadow-2xl border-t outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom max-w-md mx-auto"
          >
            {/* Pull bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-muted" />
            </div>

            <div className="px-5 pb-2 flex items-start justify-between">
              <div>
                <DialogPrimitive.Title className="display text-xl font-semibold">Account</DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground">Signed in as a rider.</DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* Profile card */}
              <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-4 flex items-center gap-3">
                <div className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/30">{initials}</div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{name}</div>
                  {phone && <div className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5"><Phone className="size-3" /> {phone}</div>}
                  {email && <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5"><User className="size-3" /> {email}</div>}
                </div>
              </div>

              {/* Rider-only quick links. NO cart / restaurants / customer profile here —
                  the rider WebView is strictly walled off from customer surfaces. */}
              <a href="/rider/earnings" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent transition-colors tap-press">
                <div className="grid size-9 place-items-center rounded-lg bg-success/10 text-success shrink-0"><Bike className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Earnings</div>
                  <div className="text-[11px] text-muted-foreground">Trips, tips, and lifetime payout</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </a>

              <a href="/rider/history" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent transition-colors tap-press">
                <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0"><ShieldCheck className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Delivery history</div>
                  <div className="text-[11px] text-muted-foreground">Recent completed orders</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </a>

              <a href="/rider/feedback" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent transition-colors tap-press">
                <div className="grid size-9 place-items-center rounded-lg bg-warning/10 text-warning shrink-0"><Star className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Your ratings</div>
                  <div className="text-[11px] text-muted-foreground">How customers rate your deliveries</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </a>

              {/* My profile — first profile-focused link. Routes to the
                  Personal tab on the unified rider profile page. */}
              <a href="/rider/profile?tab=personal" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent transition-colors tap-press">
                <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0"><User className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">My profile</div>
                  <div className="text-[11px] text-muted-foreground">Name, email, language &amp; emergency contact</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </a>

              {/* Profile · KYC — replaces the old "Documents · KYC" link.
                  Now points at the unified profile page on the Documents tab.
                  The old /rider/kyc URL redirects here too for backwards-compat. */}
              <a href="/rider/profile?tab=documents" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent transition-colors tap-press">
                <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0"><BadgeCheck className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Profile &middot; KYC</div>
                  <div className="text-[11px] text-muted-foreground">Aadhaar, licence, insurance &amp; more</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </a>

              {/* Heartbeat status — small section showing the online dot and
                  the age of the last GPS ping. Updates while the sheet is open. */}
              <div className="rounded-xl border bg-card p-3 flex items-center gap-3" aria-live="polite">
                <div className={`relative grid size-9 place-items-center rounded-lg shrink-0 ${online ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                  {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
                  {online && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-card pulse-soft" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    Heartbeat status
                    <span className={`inline-block size-1.5 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`} />
                    <span className="text-[11px] font-normal text-muted-foreground">{online ? 'Online' : 'Offline'}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="size-3" /> Last GPS ping: {pingAgeLabel}
                  </div>
                </div>
              </div>

              {/* Sign out — big, prominent */}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-destructive/30 bg-destructive/5 text-destructive font-semibold p-4 hover:bg-destructive/10 active:scale-[0.98] transition-all disabled:opacity-60 tap-press"
              >
                <LogOut className="size-5" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>

              <p className="text-[11px] text-muted-foreground text-center">
                Tip: closing the app won't sign you out — use this button.
              </p>
            </div>

            <div className="h-[env(safe-area-inset-bottom)]" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/**
 * Returns a short human-readable age string for a heartbeat timestamp:
 *  "just now", "12s ago", "3m ago", "1h 4m ago", or "—" if no data yet.
 */
function formatPingAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const deltaSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (deltaSec < 5) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
}
