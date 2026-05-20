'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { User, ChefHat, ShieldCheck, Sparkles } from 'lucide-react';
import { RoleTile } from '@/components/auth/role-tile';
import { MarketingPanel } from '@/components/auth/marketing-panel';

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
  restaurantsLive,
  cuisinesCount
}: {
  next?: string;
  initialRole?: LoginRole;
  restaurantsLive: number;
  cuisinesCount: number;
}) {
  const [role, setRole] = useState<LoginRole>(initialRole);

  // Phone OTP state
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Email/password state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  const activeSpec = ROLES.find((r) => r.id === role)!;

  function switchRole(next: LoginRole) {
    setRole(next);
    // Reset transient form state when switching, but keep typed identifiers.
    setOtpSent(false);
    setDevCode(null);
    setCode('');
  }

  async function sendOtp() {
    if (!/^\+?\d{10,15}$/.test(phone)) return toast.error('Enter a valid phone number with country code (e.g. +9198…)');
    setBusy(true);
    try {
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
    const r = await signIn('phone-otp', { phone, code, purpose: 'login', redirect: false });
    setBusy(false);
    if (r?.error) return toast.error('Invalid or expired code');
    // Customers land on the restaurant picker (/restaurants) so they immediately
    // choose a restaurant, then see its menu. routeByRole returns /restaurants
    // for the CUSTOMER role; this fallback covers the rare case /api/me is slow.
    await routeByRole('/restaurants');
  }

  async function loginEmail() {
    setBusy(true);
    const r = await signIn('email-password', { email, password, redirect: false });
    if (r?.error) { setBusy(false); return toast.error('Invalid credentials'); }
    // If a restaurant was chosen, set it as the active one now that we're
    // authenticated. The endpoint validates membership and ignores a restaurant
    // the user can't access, so a wrong pick just falls back to their default —
    // it never blocks login.
    if (role === 'staff' && selectedRestaurantId) {
      await fetch('/api/admin/active-restaurant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: selectedRestaurantId })
      }).catch(() => {});
    }
    setBusy(false);
    await routeByRole(role === 'super' ? '/platform' : '/admin');
  }

  return (
    <div className="container py-8 md:py-12">
      <div className="grid gap-6 md:grid-cols-[45fr_55fr] md:gap-10">
        {/* ── Left: marketing panel (mobile: compact hero strip) ── */}
        <div className="md:hidden">
          <MarketingPanel
            restaurantsLive={restaurantsLive}
            cuisinesCount={cuisinesCount}
            compact
          />
        </div>
        <div className="hidden md:block">
          <MarketingPanel
            restaurantsLive={restaurantsLive}
            cuisinesCount={cuisinesCount}
          />
        </div>

        {/* ── Right: role tiles + form ── */}
        <div className="flex flex-col">
          <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm md:p-8">
            {/* Role tiles */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                I&apos;m signing in as
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ROLES.map((r) => (
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
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); loginEmail(); }}>
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
                        Pick the restaurant you manage, then sign in with your staff credentials.
                      </p>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <Button className="w-full gap-2" size="lg" disabled={busy} type="submit">
                    <Sparkles className="size-4" />
                    {busy ? 'Signing in…' : 'Sign in'}
                  </Button>
                  {role === 'staff' && (
                    <p className="text-xs text-muted-foreground">Demo · admin@restaurant.local / Admin@12345</p>
                  )}
                  {role === 'super' && (
                    <p className="text-xs text-muted-foreground">Restricted to platform operators.</p>
                  )}
                </form>
              )}

              <p className="mt-5 border-t border-border/60 pt-5 text-xs text-muted-foreground">
                Use phone OTP for customers, email + password for restaurant
                staff and platform admins.
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
