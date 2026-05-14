'use client';
/**
 * Per-restaurant customer sign-in (phone OTP only).
 *
 * The tenant context (restaurant `slug`) is already decided by the URL, so
 * unlike `/login` we don't show role tiles — this form is exclusively the
 * customer phone-OTP path. After a successful verify we hard-navigate back
 * to `/r/<slug>` so the menu page reloads with the customer header.
 */
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function CustomerLoginClient({ slug, googleEnabled = false }: { slug: string; googleEnabled?: boolean }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    if (!/^\+?\d{10,15}$/.test(phone)) {
      return toast.error('Enter a valid phone number with country code (e.g. +9198…)');
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
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
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    const r = await signIn('phone-otp', { phone, code, purpose: 'login', redirect: false });
    setBusy(false);
    if (r?.error) return toast.error('Invalid or expired code');
    // Hard-navigate back to the restaurant page so the layout/header re-renders
    // with the signed-in state (matches /login's `routeByRole` behaviour).
    window.location.href = `/r/${slug}`;
  }

  return (
    <div className="space-y-4">
      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => signIn('google', { callbackUrl: `/r/${slug}` })}
          >
            {/* Inline Google "G" mark — keeps the bundle free of an extra icon dep. */}
            <svg aria-hidden="true" viewBox="0 0 18 18" className="size-4">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.92v2.32A9 9 0 0 0 9 18Z"/>
              <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.92A9 9 0 0 0 0 9c0 1.45.35 2.83.92 4.04l3.05-2.32Z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .92 4.96l3.05 2.32C4.68 5.16 6.66 3.58 9 3.58Z"/>
            </svg>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      {!otpSent ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            sendOtp();
          }}
        >
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
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Send OTP'}
          </Button>
          <p className="text-xs text-muted-foreground">
            We&apos;ll text a 6-digit code. Standard SMS rates may apply.
          </p>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            verifyOtp();
          }}
        >
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
          <Button className="w-full" disabled={busy} type="submit">
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
      )}
    </div>
  );
}
