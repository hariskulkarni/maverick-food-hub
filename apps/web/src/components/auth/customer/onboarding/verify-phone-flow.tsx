'use client';
/**
 * Add (or change) a signed-in customer's mobile number, proven by OTP.
 *
 *   phone → otp → success            (number saved as verified)
 *              ↘ link                (number has an existing phone-only account:
 *                                     confirm to link this Google sign-in to it)
 *              ↘ conflict            (number belongs to someone we can't merge)
 *
 * Talks to POST /api/customer/phone/otp and /verify; honours the server's
 * resend cooldown / rate limits (429 + retryAfter) and shows the on-screen code
 * for pre-launch test accounts. After a successful verify it refreshes
 * /api/auth/session so the session cookie carries the verified flag.
 */
import { useEffect, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { ArrowLeft, ArrowRight, Check, FlaskConical, Link2, Loader2, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhoneField } from '../phone-field';
import { OtpField } from '../otp-field';
import { ConfettiBurst } from './confetti-burst';
import { formatIndianMobile, isCompleteOtp, isValidIndianMobile, nationalFromE164 } from '@/lib/customer-auth';
import { welcomeUrl } from '@/lib/onboarding';

export type VerifyPhase = 'phone' | 'otp' | 'success' | 'link' | 'conflict';

/** Friendly inline validation for the mobile number; null = fine. */
export function phoneInputError(e164: string): string | null {
  const d = nationalFromE164(e164);
  if (!d) return 'Pop in your 10-digit mobile number.';
  if (d.length < 10) return `Almost there — ${10 - d.length} more digit${10 - d.length === 1 ? '' : 's'} to go.`;
  if (!isValidIndianMobile(e164)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function VerifyPhoneFlow({
  mode,
  next = '/restaurants',
  initialPhone = '',
  onPhaseChange,
  onVerified,
  onCancel,
}: {
  mode: 'add' | 'change';
  /** Where to continue after linking / signing in with the phone instead. */
  next?: string;
  initialPhone?: string;
  onPhaseChange?: (phase: VerifyPhase) => void;
  onVerified: (phone: string) => void;
  onCancel?: () => void;
}) {
  const [phase, setPhaseState] = useState<VerifyPhase>('phone');
  const [phone, setPhone] = useState(initialPhone);
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [link, setLink] = useState<{ ticket: string; maskedName: string | null; message: string } | null>(null);
  const [conflict, setConflict] = useState<{ message: string; canSignInWithPhone: boolean } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function setPhase(p: VerifyPhase) {
    setPhaseState(p);
    onPhaseChange?.(p);
  }

  const liveError = touched ? phoneInputError(phone) : null;
  const phoneOk = !phoneInputError(phone);

  async function sendCode() {
    setTouched(true);
    const v = phoneInputError(phone);
    if (v) return setError(v);
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/customer/phone/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429 && Number(data?.retryAfter) > 0) {
        setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        setNow(Date.now());
      }
      if (!r.ok) throw new Error(data?.error || 'Could not send the code. Please try again.');
      setResendAt(Date.now() + 45_000);
      setNow(Date.now());
      setDevCode(data.devCode ?? null);
      setCode('');
      setPhase('otp');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(c = code) {
    if (!isCompleteOtp(c) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/customer/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: c }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.status === 'verified') {
        // Re-issue the session cookie so middleware sees the verified phone.
        await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => {});
        setPhase('success');
        setTimeout(() => onVerified(phone), prefersReducedMotion() ? 0 : 1200);
        return;
      }
      if (r.ok && data.status === 'link_available') {
        setLink({ ticket: data.ticket, maskedName: data.maskedName ?? null, message: data.message });
        setPhase('link');
        return;
      }
      if (r.status === 409) {
        setConflict({ message: data.error, canSignInWithPhone: !!data.canSignInWithPhone });
        setPhase('conflict');
        return;
      }
      setError(data.error || 'That code did not work. Please try again.');
      setCode('');
      setShakeKey((k) => k + 1);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function linkAccounts() {
    if (!link) return;
    setBusy(true);
    setError(null);
    const r = await signIn('phone-link', { ticket: link.ticket, redirect: false }).catch(() => null);
    if (!r || r.error) {
      setBusy(false);
      setLink(null);
      setPhase('phone');
      setError('That link has expired. Verify your number again to continue.');
      return;
    }
    window.location.href = welcomeUrl(next);
  }

  function startOver() {
    setPhase('phone');
    setCode('');
    setDevCode(null);
    setError(null);
    setLink(null);
    setConflict(null);
  }

  if (phase === 'success') {
    return (
      <div className="relative flex min-h-[220px] flex-col items-center justify-center gap-3 text-center" role="status" aria-live="polite">
        <ConfettiBurst />
        <span className="pop-in flex size-20 items-center justify-center rounded-full bg-success text-success-foreground shadow-lg shadow-success/30">
          <Check className="size-10" strokeWidth={3} aria-hidden="true" />
        </span>
        <p className="font-display text-2xl font-extrabold tracking-tight">Number verified!</p>
        <p className="text-sm text-muted-foreground">{formatIndianMobile(phone)} is all set for delivery updates.</p>
      </div>
    );
  }

  if (phase === 'link' && link) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4" role="status" aria-live="polite">
          <p className="font-semibold">{link.message}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {link.maskedName ? <>It&apos;s the account for <span className="font-semibold text-foreground">{link.maskedName}</span>. </> : null}
            Link this Google sign-in to it so your orders, wallet and addresses stay in one place. Next time either way of signing in works.
          </p>
        </div>
        <InlineError id="link-error" message={error} />
        <Button type="button" size="lg" className="h-14 w-full rounded-xl text-base font-bold" onClick={() => void linkAccounts()} disabled={busy}>
          {busy ? <><Loader2 className="animate-spin" aria-hidden="true" /> Linking…</> : <><Link2 aria-hidden="true" /> Link &amp; continue</>}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={startOver} disabled={busy}>
          Use a different number
        </Button>
      </div>
    );
  }

  if (phase === 'conflict' && conflict) {
    return (
      <div className="space-y-5">
        <p className="rounded-2xl border-2 border-warning/50 bg-warning/10 p-4 text-sm font-medium" role="alert">
          {conflict.message}
        </p>
        {conflict.canSignInWithPhone && mode === 'add' && (
          <Button
            type="button"
            size="lg"
            className="h-14 w-full rounded-xl text-base font-bold"
            onClick={() => void signOut({ callbackUrl: `/login?next=${encodeURIComponent(next)}` })}
          >
            Sign in with this number instead
          </Button>
        )}
        <Button type="button" variant={conflict.canSignInWithPhone && mode === 'add' ? 'ghost' : 'default'} className="min-h-11 w-full" onClick={startOver}>
          Use a different number
        </Button>
      </div>
    );
  }

  if (phase === 'otp') {
    const codeOk = isCompleteOtp(code);
    return (
      <form noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
        <div>
          <button
            type="button"
            onClick={startOver}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Change number
          </button>
          <p id="vp-otp-help" className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {devCode ? 'Test account: no SMS is sent for this number.' : <>We texted a 6-digit code to <span className="font-semibold text-foreground">{formatIndianMobile(phone)}</span></>}
          </p>
        </div>
        {devCode && (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-warning/60 bg-warning/10 p-3.5" role="status">
            <FlaskConical className="size-5 shrink-0 text-warning-foreground dark:text-warning" aria-hidden="true" />
            <div className="text-sm">
              Test code: <span className="font-mono text-base font-bold tracking-[0.2em] text-foreground">{devCode}</span>
            </div>
          </div>
        )}
        <div key={shakeKey} className={shakeKey ? 'ob-shake' : undefined}>
          <OtpField
            value={code}
            onChange={(v) => { setCode(v); setError(null); }}
            onComplete={(c) => void verify(c)}
            disabled={busy}
            invalid={!!error}
            describedBy="vp-otp-help vp-otp-error"
            animated
          />
        </div>
        <InlineError id="vp-otp-error" message={error} />
        <Button type="submit" size="lg" className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/25" disabled={busy || !codeOk}>
          {busy ? <><Loader2 className="animate-spin" aria-hidden="true" /> Checking…</> : <><ShieldCheck aria-hidden="true" /> Verify number</>}
        </Button>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <MessageSquareText className="size-4" aria-hidden="true" />
          {resendIn > 0 ? (
            <span aria-live="polite">Didn&apos;t get it? Resend in <span className="font-semibold tabular-nums text-foreground">{resendIn}s</span></span>
          ) : (
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Resend code
            </button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy) void sendCode(); }}>
      <div className="space-y-2">
        <label htmlFor="vp-phone" className="block text-sm font-semibold text-foreground">
          {mode === 'change' ? 'New mobile number' : 'Your mobile number'}
        </label>
        <div onBlur={() => setTouched(true)}>
          <PhoneField
            id="vp-phone"
            value={phone}
            onChange={(v) => { setPhone(v); setError(null); }}
            disabled={busy}
            invalid={!!(error || liveError)}
            describedBy="vp-phone-help vp-phone-error"
            autoFocus
          />
        </div>
        <p id="vp-phone-help" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {phoneOk ? (
            <><Check className="size-4 text-success" aria-hidden="true" /> Looks good! We&apos;ll text you a 6-digit code.</>
          ) : (
            'Riders and restaurants use it to reach you about your order.'
          )}
        </p>
      </div>
      <InlineError id="vp-phone-error" message={error ?? liveError} />
      <Button type="submit" size="lg" className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/25" disabled={busy}>
        {busy ? <><Loader2 className="animate-spin" aria-hidden="true" /> Sending code…</> : <>Send code <ArrowRight aria-hidden="true" /></>}
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      )}
    </form>
  );
}

function InlineError({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} role="alert" aria-live="assertive" className={message ? 'rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive' : 'sr-only'}>
      {message ?? ''}
    </p>
  );
}
