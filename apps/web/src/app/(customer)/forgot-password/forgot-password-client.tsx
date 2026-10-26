'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function ForgotPasswordClient() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (r.status === 429) {
        toast.error('Too many requests. Please try again in a few minutes.');
        return;
      }
      // Neutral outcome regardless of whether the account exists.
      setSent(true);
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm">If an account exists for that email, we&apos;ve sent a reset link.</p>
        <p className="text-xs text-muted-foreground">The link is valid for 30 minutes and can be used once.</p>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/login">Back to sign in</Link>
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
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="h-11"
          required
        />
      </div>
      <Button className="w-full" size="lg" disabled={busy} type="submit">
        {busy ? 'Sending…' : 'Send reset link'}
      </Button>
      <Link href="/login" className="flex min-h-11 items-center justify-center text-sm text-muted-foreground hover:text-foreground">
        ← Back to sign in
      </Link>
    </form>
  );
}
