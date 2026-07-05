'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';

/**
 * DeleteAccount — self-serve "right to erasure" (DPDP Act). Requires the user
 * to type DELETE, then anonymises their data server-side and signs them out.
 */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const armed = confirm.trim().toUpperCase() === 'DELETE';

  async function remove() {
    if (!armed) { toast.error('Type DELETE to confirm'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/customer/delete-account', { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${r.status})`);
      }
      toast.success('Your account and personal data have been deleted.');
      await signOut({ redirect: false }).catch(() => {});
      window.location.href = '/';
    } catch (e: any) {
      toast.error('Deletion failed', { description: String(e?.message || e).slice(0, 200) });
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-destructive">Delete my account & data</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently removes your personal data — name, email, phone, saved addresses and photo.
            Past orders are kept in anonymised form for legal and tax records. This cannot be undone.
          </p>
          {!open ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setOpen(true)}
            >
              <Trash2 className="size-4" /> Delete my account
            </Button>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block text-sm font-medium">
                Type <span className="font-mono">DELETE</span> to confirm
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="DELETE"
                className="h-9 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm focus:border-destructive focus:outline-none"
              />
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy || !armed}
                  onClick={remove}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  {busy ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setConfirm(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
