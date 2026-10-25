'use client';
/**
 * Per-restaurant customer sign-in (phone OTP, plus Google when configured).
 *
 * The tenant context (restaurant `slug`) is already decided by the URL, so
 * unlike `/login` we don't show role tiles — this form is exclusively the
 * customer path. After a successful verify we hard-navigate back to
 * `/r/<slug>` so the menu page reloads with the customer header.
 */
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { CustomerPhoneFlow } from '@/components/auth/customer/customer-phone-flow';

export function CustomerLoginClient({ slug, googleEnabled = false }: { slug: string; googleEnabled?: boolean }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirror the server's 45s resend cooldown so the button explains itself.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function sendOtp() {
    if (!/^\+?\d{10,15}$/.test(phone)) {
      return setError('Enter your 10-digit mobile number.');
    }
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await r.json();
      if (r.status === 429 && Number(data?.retryAfter) > 0) {
        setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        setNow(Date.now());
      }
      if (!r.ok) throw new Error(data?.error || 'Could not send the code. Please try again.');
      setResendAt(Date.now() + 45_000);
      setNow(Date.now());
      setOtpSent(true);
      if (data.devCode) {
        setDevCode(data.devCode);
        toast.success(`Test code: ${data.devCode}`);
      } else {
        toast.success('OTP sent');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    const r = await signIn('phone-otp', { phone, code, purpose: 'login', redirect: false });
    setBusy(false);
    if (r?.error) return setError('That code is wrong or has expired. Check it, or tap Resend code.');
    // Hard-navigate back to the restaurant page so the layout/header re-renders
    // with the signed-in state (matches /login's `routeByRole` behaviour).
    window.location.href = `/r/${slug}`;
  }

  return (
    <CustomerPhoneFlow
      step={otpSent ? 'otp' : 'phone'}
      phone={phone}
      onPhoneChange={(v) => { setPhone(v); setError(null); }}
      code={code}
      onCodeChange={(v) => { setCode(v); setError(null); }}
      busy={busy}
      error={error}
      devCode={devCode}
      resendIn={resendIn}
      onSendOtp={() => { void sendOtp(); }}
      onVerify={() => { void verifyOtp(); }}
      onResend={() => { setCode(''); void sendOtp(); }}
      onChangeNumber={() => { setOtpSent(false); setCode(''); setDevCode(null); setError(null); }}
      googleEnabled={googleEnabled}
      onGoogle={() => { void signIn('google', { callbackUrl: `/r/${slug}` }); }}
    />
  );
}
