'use client';
/**
 * The interactive customer sign-up / onboarding stepper (/welcome).
 *
 *   welcome  → "Continue with Google" (primary) or mobile OTP
 *   phone    → mandatory: add an Indian mobile …
 *   verify   → … and prove it by OTP (confetti on success)
 *   about    → optional: first name + favourite cuisines (skippable)
 *   address  → optional: first delivery address with the map picker (skippable)
 *   done     → "You're in!" celebration, then on to `next`
 *
 * The server page decides the starting step from the live account state;
 * this component only moves forward/back through the steps and calls the
 * existing APIs (OTP, phone verify, onboarding, addresses).
 */
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import {
  ArrowLeft, ArrowRight, Beef, CakeSlice, Coffee, CookingPot, Flame, Loader2, MapPin, PartyPopper, Pizza, Salad,
  Sandwich, Soup, Sparkles, UtensilsCrossed, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GoogleButton } from '@/components/auth/customer/google-button';
import { CustomerPhoneFlow, CustomerAuthLegal } from '@/components/auth/customer/customer-phone-flow';
import { StepProgress } from '@/components/auth/customer/onboarding/step-progress';
import { StepArt } from '@/components/auth/customer/onboarding/illustrations';
import { ConfettiBurst } from '@/components/auth/customer/onboarding/confetti-burst';
import { VerifyPhoneFlow, type VerifyPhase } from '@/components/auth/customer/onboarding/verify-phone-flow';
import { msg91Enabled } from '@/lib/msg91-otp';
import {
  CUISINES, MAX_CUISINES, NAME_MAX, ONBOARDING_STEPS, toggleCuisine, validateDisplayName, welcomeUrl, type OnboardingStep,
} from '@/lib/onboarding';
import type { PickedAddress } from '@/components/address-picker';
import { cn } from '@/lib/utils';

// Leaflet map — only loaded when the customer opens the address step.
const AddressPicker = dynamic(() => import('@/components/address-picker').then((m) => m.AddressPicker), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-2xl bg-muted" aria-label="Loading map" />,
});

const CUISINE_ICON: Record<string, LucideIcon> = {
  Biryani: CookingPot,
  'North Indian': Flame,
  'South Indian': Soup,
  Chinese: UtensilsCrossed,
  Pizza: Pizza,
  Burgers: Beef,
  'Street Food': Sandwich,
  Desserts: CakeSlice,
  Healthy: Salad,
  'Café & Bakes': Coffee,
};

const COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  welcome: { title: 'Hungry? Let’s get you in.', subtitle: 'Join in under a minute — every kitchen in town, tracked live to your door.' },
  phone: { title: 'Add your mobile number', subtitle: 'Riders and restaurants use it to reach you about your order. We never share it for marketing.' },
  verify: { title: 'Check your messages', subtitle: 'Type or paste the 6-digit code we just sent.' },
  about: { title: 'What should we call you?', subtitle: 'Tell us your name and the food you love — we’ll put your favourites first.' },
  address: { title: 'Where do we deliver?', subtitle: 'Save your first address now, or add it at checkout.' },
  done: { title: 'You’re in!', subtitle: 'Your table is set. Let’s find something delicious.' },
};

export type WelcomeUser = { name: string | null; favoriteCuisines: string[]; addressCount: number; onboarded: boolean };

export function WelcomeClient({
  initialStep,
  next,
  googleEnabled,
  selfSignupOpen,
  user,
}: {
  initialStep: OnboardingStep;
  next: string;
  googleEnabled: boolean;
  selfSignupOpen: boolean;
  /** null = not signed in yet. */
  user: WelcomeUser | null;
}) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [displayName, setDisplayName] = useState<string | null>(user?.name ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    // Move focus to the new step's heading so screen readers announce it.
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  function go(to: OnboardingStep) {
    setDir(ONBOARDING_STEPS.indexOf(to) >= ONBOARDING_STEPS.indexOf(step) ? 'fwd' : 'back');
    setStep(to);
  }

  const copy = COPY[step];
  const showBack = (step === 'phone' && !user) || step === 'address';

  return (
    <div className="gradient-hero relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden px-4 pb-16 pt-6 sm:pt-10">
      <FloatingFood />
      <div className="relative mx-auto w-full max-w-lg">
        <div className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card p-5 shadow-[0_24px_60px_-28px_hsl(var(--berry)/0.35)] sm:p-8">
          {step === 'done' && <ConfettiBurst pieces={40} />}
          <StepProgress step={step} />

          <div className="relative mt-6">
            <StepArt step={step} />
          </div>

          {/* phone → verify is one form (it keeps its state), so they share a key. */}
          <div key={step === 'verify' ? 'phone' : step} className={cn('mt-4', dir === 'fwd' ? 'ob-enter-fwd' : 'ob-enter-back')}>
            {showBack && (
              <button
                type="button"
                onClick={() => go(step === 'address' ? 'about' : 'welcome')}
                className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </button>
            )}
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-balance font-display text-2xl font-extrabold tracking-tight focus:outline-none focus-visible:[box-shadow:none] sm:text-3xl"
            >
              {step === 'done' && displayName ? `You’re in, ${displayName.split(' ')[0]}!` : copy.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{copy.subtitle}</p>

            <div className="mt-6">
              {step === 'welcome' && (
                <WelcomeStep
                  googleEnabled={googleEnabled}
                  next={next}
                  onPhone={() => go('phone')}
                />
              )}
              {(step === 'phone' || step === 'verify') && !user && (
                <AnonymousPhoneStep next={next} selfSignupOpen={selfSignupOpen} onPhase={(p) => setStep(p === 'otp' ? 'verify' : 'phone')} />
              )}
              {(step === 'phone' || step === 'verify') && user && (
                <VerifyPhoneFlow
                  mode="add"
                  next={next}
                  onPhaseChange={(p: VerifyPhase) => setStep(p === 'phone' ? 'phone' : 'verify')}
                  onVerified={() => {
                    if (user.onboarded) window.location.href = next;
                    else go('about');
                  }}
                />
              )}
              {step === 'about' && user && <AboutStep user={user} onSaved={setDisplayName} onDone={() => go('address')} />}
              {step === 'address' && user && <AddressStep addressCount={user.addressCount} onDone={() => go('done')} />}
              {step === 'done' && <DoneStep next={next} />}
            </div>
          </div>
        </div>
        {step === 'welcome' && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already ordering with us?{' '}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

function WelcomeStep({ googleEnabled, next, onPhone }: { googleEnabled: boolean; next: string; onPhone: () => void }) {
  const [busy, setBusy] = useState(false);
  // MSG91 widget (multi-channel OTP) lives on /login; hand the phone path there.
  const phoneHref = `/login?next=${encodeURIComponent(welcomeUrl(next))}`;
  return (
    <div className="space-y-4">
      {googleEnabled && (
        <GoogleButton
          className="h-14 text-base"
          disabled={busy}
          onClick={() => { setBusy(true); void signIn('google', { callbackUrl: welcomeUrl(next) }); }}
        />
      )}
      {googleEnabled && (
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {msg91Enabled ? (
        <Button asChild variant="outline" size="lg" className="h-14 w-full rounded-xl text-base font-bold">
          <Link href={phoneHref}>Use my mobile number <ArrowRight aria-hidden="true" /></Link>
        </Button>
      ) : (
        <Button type="button" variant={googleEnabled ? 'outline' : 'default'} size="lg" className="h-14 w-full rounded-xl text-base font-bold" onClick={onPhone} disabled={busy}>
          Use my mobile number <ArrowRight aria-hidden="true" />
        </Button>
      )}
      <ul className="flex flex-wrap justify-center gap-2 pt-2 text-xs sm:text-sm">
        {[
          { Icon: MapPin, t: 'Live tracking' },
          { Icon: Sparkles, t: 'Welcome offers' },
          { Icon: PartyPopper, t: 'One-tap reorders' },
        ].map(({ Icon, t }) => (
          <li key={t} className="flex items-center gap-1.5 rounded-full bg-muted/70 px-3 py-2 font-medium">
            <Icon className="size-4 text-primary" aria-hidden="true" /> {t}
          </li>
        ))}
      </ul>
      <CustomerAuthLegal />
    </div>
  );
}

/** Not signed in, mobile path: the existing phone-OTP sign-in (creates the account). */
function AnonymousPhoneStep({ next, selfSignupOpen, onPhase }: { next: string; selfSignupOpen: boolean; onPhase: (p: 'phone' | 'otp') => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function send() {
    if (!/^\+91[6-9]\d{9}$/.test(phone)) return setError('Enter your 10-digit mobile number (starts with 6, 7, 8 or 9).');
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429 && Number(data?.retryAfter) > 0) {
        setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        setNow(Date.now());
      }
      if (!r.ok) throw new Error(data?.error || 'Could not send the code. Please try again.');
      setResendAt(Date.now() + 45_000);
      setNow(Date.now());
      setDevCode(data.devCode ?? null);
      setSent(true);
      onPhase('otp');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(typed?: string) {
    setBusy(true);
    const r = await signIn('phone-otp', { phone, code: typed ?? code, purpose: 'login', redirect: false }).catch(() => null);
    if (!r || r.error) {
      setBusy(false);
      setCode('');
      setError(
        selfSignupOpen
          ? 'That code is wrong or has expired. Check it, or tap Resend code.'
          : 'That code didn’t work — or this number isn’t invited yet. Flavrly is invite-only right now.',
      );
      return;
    }
    setSuccess(true);
    // Fresh page load: the server picks the next step for this account.
    setTimeout(() => { window.location.href = welcomeUrl(next); }, 900);
  }

  if (success) {
    return (
      <div className="relative flex min-h-[180px] flex-col items-center justify-center gap-2 text-center" role="status" aria-live="polite">
        <ConfettiBurst />
        <span className="pop-in flex size-16 items-center justify-center rounded-full bg-success text-success-foreground">
          <Sparkles className="size-8" aria-hidden="true" />
        </span>
        <p className="font-display text-xl font-extrabold">Verified! Setting your table…</p>
      </div>
    );
  }

  return (
    <CustomerPhoneFlow
      step={sent ? 'otp' : 'phone'}
      phone={phone}
      onPhoneChange={(v) => { setPhone(v); setError(null); }}
      code={code}
      onCodeChange={(v) => { setCode(v); setError(null); }}
      busy={busy}
      error={error}
      devCode={devCode}
      resendIn={resendIn}
      onSendOtp={() => void send()}
      onVerify={(c) => void verify(c)}
      onResend={() => { setCode(''); void send(); }}
      onChangeNumber={() => { setSent(false); setCode(''); setDevCode(null); setError(null); onPhase('phone'); }}
      otpAnimated
    />
  );
}

function AboutStep({ user, onSaved, onDone }: { user: WelcomeUser; onSaved: (name: string) => void; onDone: () => void }) {
  const [name, setName] = useState(user.name ?? '');
  const [touched, setTouched] = useState(false);
  const [cuisines, setCuisines] = useState<string[]>(user.favoriteCuisines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameError = touched ? validateDisplayName(name) : null;

  async function save() {
    setTouched(true);
    if (validateDisplayName(name)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/customer/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(name.trim() ? { name: name.trim() } : {}), favoriteCuisines: cuisines }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save that. Please try again.');
      if (name.trim()) onSaved(name.trim());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const atMax = cuisines.length >= MAX_CUISINES;
  return (
    <form noValidate className="space-y-6" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="space-y-2">
        <label htmlFor="ob-name" className="block text-sm font-semibold">First name <span className="font-normal text-muted-foreground">(optional)</span></label>
        <Input
          id="ob-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={NAME_MAX}
          autoComplete="given-name"
          placeholder="e.g. Priya"
          aria-invalid={!!nameError || undefined}
          aria-describedby="ob-name-error"
          className="h-12 rounded-xl text-base"
        />
        <p id="ob-name-error" role="alert" aria-live="polite" className={nameError ? 'text-sm font-medium text-destructive' : 'sr-only'}>
          {nameError ?? ''}
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">
          Favourite cuisines <span className="font-normal text-muted-foreground">(pick up to {MAX_CUISINES})</span>
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CUISINES.map((c) => {
            const on = cuisines.includes(c);
            const Icon = CUISINE_ICON[c] ?? UtensilsCrossed;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                disabled={!on && atMax}
                onClick={() => setCuisines((s) => toggleCuisine(s, c))}
                className={cn(
                  'tap-press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-3.5 text-sm font-semibold transition-colors duration-200',
                  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-45',
                  on ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25' : 'border-border bg-background hover:border-primary/50',
                )}
              >
                <Icon className={cn('size-4', on && 'pop-in')} aria-hidden="true" />
                {c}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {cuisines.length ? `${cuisines.length} picked${atMax ? ' — that’s the max, great taste!' : ''}` : 'Tap to pick — or skip.'}
        </p>
      </fieldset>

      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" className="h-14 w-full rounded-xl text-base font-bold" disabled={busy}>
          {busy ? <><Loader2 className="animate-spin" aria-hidden="true" /> Saving…</> : <>Continue <ArrowRight aria-hidden="true" /></>}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onDone} disabled={busy}>
          Skip for now
        </Button>
      </div>
    </form>
  );
}

const EMPTY_ADDRESS: PickedAddress = {
  label: 'Home', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'IN', latitude: null, longitude: null,
};

/** Friendly validation for the first address; null = ready to save. */
export function addressError(a: PickedAddress): string | null {
  if (a.line1.trim().length < 2) return 'Add your flat / house and street (line 1).';
  if (!a.city.trim()) return 'Which city is this in?';
  if (!/^\d{6}$/.test(a.postalCode.trim())) return 'PIN codes have 6 digits.';
  return null;
}

function AddressStep({ addressCount, onDone }: { addressCount: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [addr, setAddr] = useState<PickedAddress>(EMPTY_ADDRESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (addressCount > 0) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium" role="status">
          <MapPin className="size-4 text-success" aria-hidden="true" />
          You already have {addressCount} saved address{addressCount === 1 ? '' : 'es'}. Nice!
        </p>
        <Button type="button" size="lg" className="h-14 w-full rounded-xl text-base font-bold" onClick={onDone}>
          Continue <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    );
  }

  async function save() {
    const v = addressError(addr);
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/customer/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addr, label: addr.label.trim() || 'Home', isDefault: true }),
      });
      if (!r.ok) throw new Error('Could not save the address. Check the fields and try again.');
      toast.success('Address saved');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="h-14 w-full rounded-xl text-base font-bold" onClick={() => setOpen(true)}>
          <MapPin aria-hidden="true" /> Add delivery address
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onDone}>
          I&apos;ll add it at checkout
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AddressPicker initial={EMPTY_ADDRESS} onChange={(a) => { setAddr(a); setError(null); }} />
      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="h-14 w-full rounded-xl text-base font-bold" onClick={() => void save()} disabled={busy}>
          {busy ? <><Loader2 className="animate-spin" aria-hidden="true" /> Saving…</> : 'Save address'}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onDone} disabled={busy}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function DoneStep({ next }: { next: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Mark onboarding complete as soon as the celebration shows.
    fetch('/api/customer/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true }),
    })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <Button
        type="button"
        size="lg"
        className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/25"
        disabled={!ready}
        onClick={() => { window.location.href = next; }}
      >
        {ready ? <>Start exploring <ArrowRight aria-hidden="true" /></> : <><Loader2 className="animate-spin" aria-hidden="true" /> Setting the table…</>}
      </Button>
    </div>
  );
}

/** Decorative floating food glyphs around the card on wide screens. */
function FloatingFood() {
  const items: { Icon: LucideIcon; cls: string }[] = [
    { Icon: Pizza, cls: 'left-[8%] top-24 rotate-[-12deg] text-primary' },
    { Icon: CakeSlice, cls: 'left-[14%] bottom-24 rotate-[10deg] text-berry' },
    { Icon: Coffee, cls: 'right-[10%] top-32 rotate-[8deg] text-berry' },
    { Icon: Soup, cls: 'right-[14%] bottom-28 rotate-[-6deg] text-primary' },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden lg:block">
      {items.map(({ Icon, cls }, i) => (
        <span key={i} className={cn('float-soft absolute flex size-20 items-center justify-center rounded-3xl bg-card/80 shadow-lg ring-1 ring-border/60', cls)} style={{ animationDelay: `${i * 0.8}s` }}>
          <Icon className="size-10" strokeWidth={1.75} />
        </span>
      ))}
    </div>
  );
}
