'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2, KeyRound } from 'lucide-react';

/** ChangePassword — signed-in user changes own password (other devices are signed out). */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && next.length >= 12 && next === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const r = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (r.ok) {
        toast.success('Password changed. Other devices were signed out.');
        setCurrent(''); setNext(''); setConfirm('');
      } else {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error === 'invalid_current' ? 'Could not change password. Check your details.' : (j.message || 'Could not change password.'));
      }
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'h-9 w-full max-w-sm rounded-md border border-input bg-card px-3 text-sm focus:border-primary focus:outline-none';
  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border bg-card p-4 md:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" />
        <h3 className="font-semibold">Change password</h3>
      </div>
      <input type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} />
      <input type="password" autoComplete="new-password" placeholder="New password (min 12 characters)" aria-label="New password" className={input} value={next} onChange={(e) => setNext(e.target.value)} />
      <input type="password" autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
      <Button size="sm" type="submit" disabled={busy || !valid}>
        {busy && <Loader2 className="size-4 animate-spin" />} {busy ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
