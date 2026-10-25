'use client';
/**
 * Two-step rider sign-in: POST /api/rider/auth/request-otp (rider-only, same as
 * the app) → POST /api/rider/web/session (verifies via the app's verify-otp
 * handler and sets the httpOnly cookie). Phones are +91 + 10 digits, exactly
 * like the app's login screen.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { errorMessage } from '../_lib/api';
import { inputCls } from '../_components/bits';
import { ApplicationStatus } from './application-status';

type Step = 'phone' | 'code';

/** Keep only the 10-digit national number (strips +91 / 0 / spaces). */
export function normalizeIndianMobile(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | string | null }> {
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    let data: Record<string, unknown> | string | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function errCode(data: unknown): string | null {
  return data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : null;
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notRider, setNotRider] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const phone = `+91${digits}`;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (digits.length !== 10 || busy) return;
    setBusy(true);
    setError(null);
    setNotRider(false);
    const r = await postJson('/api/rider/auth/request-otp', { phone });
    setBusy(false);
    if (r.ok) {
      const d = (r.data ?? {}) as { devCode?: string };
      setDevCode(typeof d.devCode === 'string' && d.devCode ? d.devCode : null);
      setStep('code');
      setCode('');
      setCooldown(30);
      return;
    }
    const c = errCode(r.data);
    if (r.status === 404 && c === 'not_a_rider') {
      setNotRider(true);
      setError("That number isn't registered as a Flavrly rider.");
    } else if (r.status === 429) {
      const retry = Number((r.data as { retryAfter?: number } | null)?.retryAfter ?? 0);
      if (retry > 0) setCooldown(Math.min(retry, 3600));
      setError(c && c !== 'rate_limited' ? c : 'Too many attempts. Please wait a little and try again.');
    } else {
      setError(errorMessage(r.status, r.data));
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson('/api/rider/web/session', { phone, code });
    if (r.ok) {
      router.replace('/rider');
      router.refresh();
      return;
    }
    setBusy(false);
    const c = errCode(r.data);
    if (c === 'invalid_code') setError("That code didn't match or has expired. Check the SMS and try again, or resend the code.");
    else if (c === 'suspended') setError('Your rider account is suspended. Contact Flavrly rider support to find out why and how to get reinstated.');
    else if (c === 'not_a_rider') setError("That number isn't registered as a Flavrly rider.");
    else if (r.status === 429) setError('Too many attempts. Please wait a minute and try again.');
    else setError(errorMessage(r.status, r.data));
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
        {step === 'phone' ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="rider-phone">Registered rider mobile number</Label>
              <div className="mt-1 flex">
                <span className="inline-flex h-11 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-medium">+91</span>
                <input
                  id="rider-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className={cn(inputCls, 'rounded-l-none')}
                  placeholder="98765 43210"
                  value={digits}
                  onChange={(e) => setDigits(normalizeIndianMobile(e.target.value))}
                  aria-describedby="phone-help"
                />
              </div>
              <p id="phone-help" className="mt-1 text-xs text-muted-foreground">We&apos;ll text you a 6-digit code. No password needed.</p>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="min-h-12 w-full rounded-full" disabled={digits.length !== 10 || busy || cooldown > 0}>
              {busy && <Loader2 className="animate-spin" />}
              {cooldown > 0 ? `Try again in ${cooldown}s` : 'Send verification code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setError(null);
              }}
              className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Change number
            </button>
            <div>
              <Label htmlFor="rider-code">Code sent to +91 {digits}</Label>
              <input
                id="rider-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className={cn(inputCls, 'mt-1 text-center text-xl tracking-[0.4em]')}
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                autoFocus
              />
              {devCode && (
                <p className="mt-2 rounded-lg bg-muted p-2 text-xs">
                  Demo mode — your code is <span className="font-mono font-semibold">{devCode}</span>
                </p>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="min-h-12 w-full rounded-full" disabled={code.length < 4 || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify and sign in
            </Button>
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => sendCode()}
              className="block min-h-11 w-full text-sm font-medium text-primary disabled:text-muted-foreground"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </form>
        )}
      </div>

      {notRider && <ApplicationStatus phone={phone} />}
    </div>
  );
}
