'use client';

import { useState } from 'react';
import { Loader2, Send, CheckCircle2, AlertCircle } from 'lucide-react';

/** Email form for the demo gate. */
export function DemoGateForm({ initialStatus, initialEmail }: { initialStatus?: string; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail || '');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>(initialStatus === 'sent' ? 'sent' : 'idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/_demo-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || 'Could not send link');
      }
      setState('sent');
    } catch (err: any) {
      setState('error');
      setError(String(err?.message || err).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-xl border-2 border-success bg-success/5 p-5 text-center">
        <CheckCircle2 className="size-8 text-success mx-auto mb-2" />
        <div className="font-semibold">Check your inbox</div>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a magic link to <strong className="text-foreground">{email}</strong>. Click it to start the demo.
        </p>
        <button
          type="button"
          onClick={() => { setState('idle'); setError(null); }}
          className="mt-3 text-xs text-primary hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">Your email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:border-primary"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Send my magic link
      </button>
      {state === 'error' && error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
