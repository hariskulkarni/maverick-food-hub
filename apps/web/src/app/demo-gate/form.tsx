'use client';

import { useState } from 'react';
import { Loader2, LogIn, AlertCircle } from 'lucide-react';

/**
 * Password form for the demo gate.
 *
 * POSTs `{ password }` to `/api/demo-gate`. On success the API sets the
 * signed cookie and returns { ok, redirect } — we then full-reload to the
 * redirect target so middleware sees the new cookie.
 */
export function DemoGateForm({ initialError }: { initialError?: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/demo-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || 'Wrong password');
      }
      // Full reload so middleware sees the freshly-set cookie.
      window.location.href = data.redirect || '/';
    } catch (err: any) {
      setError(String(err?.message || err).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">Demo password</span>
        <input
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:border-primary"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !password}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        Enter the demo
      </button>
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
