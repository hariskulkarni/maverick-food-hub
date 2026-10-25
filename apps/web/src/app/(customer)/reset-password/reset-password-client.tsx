'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Phase =
  | { kind: 'form' }
  | { kind: 'done'; staffReenroll: boolean }
  | { kind: 'bad'; reason: 'invalid' | 'expired' };

export function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(token ? { kind: 'form' } : { kind: 'bad', reason: 'invalid' });

  async function submit() {
    setError(null);
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.ok) return setPhase({ kind: 'done', staffReenroll: !!data.staffReenroll });
      if (r.status === 429) return setError('Too many attempts. Please try again in a few minutes.');
      if (data?.reason === 'weak') return setError('Use at least 12 characters.');
      setPhase({ kind: 'bad', reason: data?.reason === 'expired' ? 'expired' : 'invalid' });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === 'done') {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm font-medium">Your password has been reset.</p>
        <p className="text-sm text-muted-foreground">
          {phase.staffReenroll
            ? "Sign in with your new password — you'll set up Google Authenticator again."
            : 'Sign in with your new password. You have been signed out of all other devices.'}
        </p>
        <p className="text-xs text-muted-foreground">
          Staff accounts keep their existing Google Authenticator. Lost your device? Ask a platform super-admin to
          reset it.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (phase.kind === 'bad') {
    return (
      <div className="space-y-4" role="alert">
        <p className="text-sm">
          {phase.reason === 'expired'
            ? 'This reset link has expired.'
            : 'This reset link is invalid or has already been used.'}
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          className="h-11"
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">At least 12 characters.</p>
      </div>
      <div>
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="h-11"
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button className="w-full" size="lg" disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Reset password'}
      </Button>
    </form>
  );
}
