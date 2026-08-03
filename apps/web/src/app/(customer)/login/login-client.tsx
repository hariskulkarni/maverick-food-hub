'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { msg91Enabled, loadMsg91Widget, sendWidgetOtp, verifyWidgetOtp, toMsg91Identifier } from '@/lib/msg91-otp';
import { User, ChefHat, ShieldCheck, Sparkles } from 'lucide-react';
import { RoleTile } from '@/components/auth/role-tile';
import { MarketingPanel } from '@/components/auth/marketing-panel';
import { PortalMarketingPanel } from '@/components/auth/portal-marketing-panel';

export type LoginRole = 'customer' | 'staff' | 'super';

// Note: there is no rider tile — delivery riders use the separate native
// Android app. The web /login surface only covers customer, staff, super.

type RoleSpec = {
  id: LoginRole;
  label: string;
  tagline: string;
  Icon: typeof User;
  auth: 'phone' | 'email';
};

const ROLES: RoleSpec[] = [
  { id: 'customer', label: 'Customer',         tagline: 'Order from anywhere',  Icon: User,        auth: 'phone' },
  { id: 'staff',    label: 'Restaurant Staff', tagline: 'Manage orders & menu', Icon: ChefHat,     auth: 'email' },
  { id: 'super',    label: 'Super Admin',      tagline: 'Platform operations',  Icon: ShieldCheck, auth: 'email' }
];

/**
 * Central /login experience. Renders as a premium two-column split on
 * desktop:
 *   - Left ~45%: <MarketingPanel> with gradient backdrop, brand wordmark,
 *     rotating value-prop line, and a 2x2 stat grid.
 *   - Right ~55%: role-picker tiles + the matching sign-in form.
 *
 * On mobile the columns collapse — the marketing panel becomes a compact
 * hero strip on top, then the role tiles and form stack below it.
 *
 * An explicit `?next=` always wins; otherwise `routeByRole` hits /api/me
 * and redirects to the canonical home for the user's actual role
 * (super → /platform, admin → /admin, kitchen → /kitchen, customer → /).
 * The role tile picked on the form is cosmetic — real routing is by the
 * actual session role.
 */
export function LoginClient({
  next,
  initialRole = 'customer',
  surface = 'all',
  restaurantsLive,
  cuisinesCount
}: {
  next?: string;
  initialRole?: LoginRole;
  surface?: 'customer' | 'portal' | 'all';
  restaurantsLive: number;
  cuisinesCount: number;
}) {
  // Roles this surface is allowed to show. flavrly.in = customer only;
  // portal.flavrly.in = staff + super; localhost/all = everything.
  const allowedRoles: LoginRole[] =
    surface === 'customer' ? ['customer']
    : surface === 'portal' ? ['staff', 'super']
    : ['customer', 'staff', 'super'];
  const clampedInitial: LoginRole = allowedRoles.includes(initialRole) ? initialRole : allowedRoles[0];
  const [role, setRole] = useState<LoginRole>(clampedInitial);

  // Phone OTP state
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Email/password state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Staff 2FA (Google Authenticator) two-step flow.
  const [staffPhase, setStaffPhase] = useState<'creds' | 'code'>('creds');
  const [totpCode, setTotpCode] = useState('');
  const [enroll, setEnroll] = useState<{ qr: string; secret: string; otpauth: string } | null>(null);

  // Restaurant picker (staff only): pick which restaurant you're signing in to.
  // Populated from the public top-level-restaurants endpoint. Optional — it just
  // pre-selects the active restaurant after login so you land in the right place.
  const [restaurants, setRestaurants] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');

  const [busy, setBusy] = useState(false);

  // Lazy-load the restaurant list the first time the staff tile is selected.
  useEffect(() => {
    if (role !== 'staff' || restaurants.length > 0) return;
    let cancelled = false;
    fetch('/api/auth/restaurants', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => { if (!cancelled) setRestaurants(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [role, restaurants.length]);

  const isPortal = surface === 'portal';
  const visibleRoles = ROLES.filter((r) => allowedRoles.includes(r.id));
  const activeSpec = ROLES.find((r) => r.id === role)!;

  function switchRole(next: LoginRole) {
    setRole(next);
    // Reset transient form state when switching, but keep typed identifiers.
    setOtpSent(false);
    setDevCode(null);
    setCode('');
    setStaffPhase('creds');
    setEnroll(null);
    setTotpCode('');
  }

  async function sendOtp() {
    if (!/^\+?\d{10,15}$/.test(phone)) return toast.error('Enter a valid phone number with country code (e.g. +9198…)');
    setBusy(true);
    try {
      if (msg91Enabled) {
        // MSG91 widget owns send + verify (multi-channel).
        await loadMsg91Widget();
        await sendWidgetOtp(toMsg91Identifier(phone));
        setOtpSent(true);
        toast.success('OTP sent');
        return;
      }
      const r = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      setOtpSent(true);
      if (data.devCode) {
        setDevCode(data.devCode);
        toast.success(`OTP sent (dev: ${data.devCode})`);
      } else {
        toast.success('OTP sent');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  /**
   * Resolve where the signed-in user belongs. Honours an explicit `next`,
   * otherwise routes by the user's actual role so a customer lands on /,
   * staff on /admin or /kitchen, etc. Uses a hard navigation so the new
   * layout (customer / admin header) loads cleanly.
   *
   * Right after `signIn` the session cookie can take a beat to propagate,
   * so `/api/me` occasionally returns `role: null` on the first read — when
   * that happens we wait ~250ms and retry once before falling back.
   */
  async function routeByRole(fallback: string) {
    if (next) { window.location.href = next; return; }
    try {
      let me = await (await fetch('/api/me', { cache: 'no-store' })).json();
      if (!me?.role) {
        // Known session-propagation race — give the cookie a moment, retry once.
        await new Promise((resolve) => setTimeout(resolve, 250));
        me = await (await fetch('/api/me', { cache: 'no-store' })).json();
      }
      const r = me?.role;
      const target =
          r === 'SUPER_ADMIN' ? '/platform'
        : r === 'ADMIN'       ? '/admin'
        : r === 'KITCHEN'     ? '/kitchen'
        : r === 'CUSTOMER'    ? '/restaurants'
        : r === 'RIDER'       ? '/rider-app'
        : fallback;
      window.location.href = target;
    } catch {
      window.location.href = fallback;
    }
  }

  async function verifyOtp() {
    setBusy(true);
    try {
      if (msg91Enabled) {
        // Verify the code in the widget, then hand the signed token to the server.
        const accessToken = await verifyWidgetOtp(code);
        const r = await signIn('msg91-widget', { accessToken, phone, redirect: false });
        if (r?.error) { toast.error('Sign-in failed. Please try again.'); return; }
        await routeByRole('/restaurants');
        return;
      }
      const r = await signIn('phone-otp', { phone, code, purpose: 'login', redirect: false });
      if (r?.error) { toast.error('Invalid or expired code'); return; }
      // Customers land on the restaurant picker (/restaurants) so they immediately
      // choose a restaurant, then see its menu. routeByRole returns /restaurants
      // for the CUSTOMER role; this fallback covers the rare case /api/me is slow.
      await routeByRole('/restaurants');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  // Staff step 1: validate password, then discover whether this account needs
  // to enrol Google Authenticator (first login) or just enter a code.
  async function staffContinue() {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/staff/precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!d?.ok) { toast.error('Invalid credentials'); return; }
      setEnroll(d.status === 'enroll' ? { qr: d.qr, secret: d.secret, otpauth: d.otpauth } : null);
      setTotpCode('');
      setStaffPhase('code');
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally { setBusy(false); }
  }

  // Staff step 2: (first time) confirm enrollment, then sign in with the code.
  async function staffSignIn() {
    if (!/^\d{6}$/.test(totpCode.trim())) return toast.error('Enter the 6-digit code from Google Authenticator.');
    setBusy(true);
    try {
      if (enroll) {
        const er = await fetch('/api/auth/staff/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, code: totpCode.trim() }),
        });
        const ed = await er.json();
        if (!ed?.ok) { toast.error("That code didn't match — enter the current 6-digit code."); return; }
      }
      const r = await signIn('email-password', { email, password, totp: totpCode.trim(), redirect: false });
      if (r?.error) { toast.error('Sign-in failed. Check your code and try again.'); return; }
      // Set the active restaurant for staff, same as before.
      if (role === 'staff' && selectedRestaurantId) {
        const resp = await fetch('/api/admin/active-restaurant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurantId: selectedRestaurantId }),
        }).catch(() => null);
        if (resp && !resp.ok) {
          const picked = restaurants.find((x) => x.id === selectedRestaurantId);
          toast.error(`This account doesn't manage ${picked?.name ?? 'that restaurant'}. Use that restaurant's owner login, or link it under a parent you own.`);
          return;
        }
      }
      await routeByRole(role === 'super' ? '/platform' : '/admin');
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="container py-8 md:py-12">
      <div className="grid gap-6 md:grid-cols-[45fr_55fr] md:gap-10">
        {/* ── Left: marketing panel (mobile: compact hero strip) ── */}
        <div className="md:hidden">
          {isPortal ? (
            <PortalMarketingPanel compact />
          ) : (
            <MarketingPanel
              restaurantsLive={restaurantsLive}
              cuisinesCount={cuisinesCount}
              compact
            />
          )}
        </div>
        <div className="hidden md:block">
          {isPortal ? (
            <PortalMarketingPanel />
          ) : (
            <MarketingPanel
              restaurantsLive={restaurantsLive}
              cuisinesCount={cuisinesCount}
            />
          )}
        </div>

        {/* ── Right: role tiles + form ── */}
        <div className="flex flex-col">
          <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm md:p-8">
            {/* Role tiles — only for roles this surface allows. Hidden when a
                surface exposes a single role (e.g. customer site). */}
            {visibleRoles.length > 1 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  I&apos;m signing in as
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleRoles.map((r) => (
                    <RoleTile
                      key={r.id}
                      Icon={r.Icon}
                      label={r.label}
                      tagline={r.tagline}
                      active={r.id === role}
                      onClick={() => switchRole(r.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Form */}
            <div className="mt-8">
              <div className="mb-5 flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <activeSpec.Icon className="size-4" />
                </span>
                <div className="text-base font-semibold">
                  Sign in as <span className="text-primary">{activeSpec.label}</span>
                </div>
              </div>

              {activeSpec.auth === 'phone' ? (
                !otpSent ? (
                  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); sendOtp(); }}>
                    <div>
                      <Label htmlFor="phone">Mobile number</Label>
                      <Input
                        id="phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+919876500001"
                        autoComplete="tel"
                        required
                      />
                    </div>
                    <Button className="w-full gap-2" size="lg" disabled={busy} type="submit">
                      <Sparkles className="size-4" />
                      {busy ? 'Sending…' : 'Send OTP'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      We&apos;ll text a 6-digit code. Standard SMS rates may apply.
                    </p>
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verifyOtp(); }}>
                    <div className="text-sm text-muted-foreground">
                      We sent a code to {phone}.{devCode && <> Dev code: <span className="font-mono">{devCode}</span></>}
                    </div>
                    <div>
                      <Label htmlFor="otp">6-digit code</Label>
                      <Input
                        id="otp"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                      />
                    </div>
                    <Button className="w-full gap-2" size="lg" disabled={busy} type="submit">
                      <Sparkles className="size-4" />
                      {busy ? 'Verifying…' : 'Verify & sign in'}
                    </Button>
                    <button
                      type="button"
                      className="w-full text-sm text-muted-foreground hover:text-foreground"
                      onClick={() => setOtpSent(false)}
                    >
                      ← change number
                    </button>
                  </form>
                )
              ) : (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (staffPhase === 'creds') staffContinue(); else staffSignIn(); }}>
                  {staffPhase === 'creds' ? (
                    <>
                      {role === 'staff' && (
                        <div>
                          <Label htmlFor="restaurant">Restaurant</Label>
                          <select
                            id="restaurant"
                            value={selectedRestaurantId}
                            onChange={(e) => setSelectedRestaurantId(e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">
                              {restaurants.length === 0 ? 'Loading restaurants…' : 'Select your restaurant'}
                            </option>
                            {restaurants.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Pick the restaurant you manage, then continue with your staff credentials.
                          </p>
                        </div>
                      )}
                      <div>
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                      </div>
                      <div>
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                      </div>
                      <Button className="w-full gap-2" size="lg" disabled={busy} type="submit">
                        <ShieldCheck className="size-4" />
                        {busy ? 'Checking…' : 'Continue'}
                      </Button>
                      <p className="text-xs text-muted-foreground">Protected by Google Authenticator (2FA). You&apos;ll enter a code next.</p>
                    </>
                  ) : (
                    <>
                      {enroll ? (
                        <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-center">
                          <div className="text-sm font-semibold">Set up Google Authenticator</div>
                          <p className="text-xs text-muted-foreground">
                            Scan this with Google Authenticator (or any TOTP app), then enter the 6-digit code it shows.
                          </p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={enroll.qr} alt="Google Authenticator setup QR code" className="mx-auto size-40 rounded-lg border bg-white p-1" />
                          <p className="text-[11px] text-muted-foreground">
                            Can&apos;t scan? Enter this key manually:
                            <br />
                            <span className="font-mono text-xs tracking-wider text-foreground break-all">{enroll.secret}</span>
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Open Google Authenticator and enter the current 6-digit code for your Flavrly account.
                        </p>
                      )}
                      <div>
                        <Label htmlFor="totp">Authenticator code</Label>
                        <Input
                          id="totp"
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          autoComplete="one-time-code"
                          placeholder="123456"
                          required
                        />
                      </div>
                      <Button className="w-full gap-2" size="lg" disabled={busy} type="submit">
                        <ShieldCheck className="size-4" />
                        {busy ? (enroll ? 'Enabling…' : 'Verifying…') : enroll ? 'Verify & enable' : 'Verify & sign in'}
                      </Button>
                      <button
                        type="button"
                        className="w-full text-sm text-muted-foreground hover:text-foreground"
                        onClick={() => { setStaffPhase('creds'); setEnroll(null); setTotpCode(''); }}
                      >
                        ← back
                      </button>
                    </>
                  )}
                </form>
              )}

              <p className="mt-5 border-t border-border/60 pt-5 text-xs text-muted-foreground">
                {isPortal
                  ? 'Staff & platform operations portal. Customers order at flavrly.in.'
                  : 'Use phone OTP to sign in. Staff & owners sign in at the operations portal.'}
              </p>
            </div>
          </div>

          {/* Footer links */}
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="font-medium">New customer?</div>
              <div className="mt-1 text-xs text-muted-foreground">
                You can sign up automatically after your first order — no separate
                form needed.
              </div>
            </div>
            <Link
              href="/signup/restaurant"
              className="group rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div className="font-medium">
                Restaurant owner?{' '}
                <span className="text-primary group-hover:underline">Open your kitchen →</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Set up your storefront in minutes — menu, branches, payments.
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
