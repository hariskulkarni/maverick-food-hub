'use client';
/**
 * Row-level "Revoke" button used on the super-admin grants table.
 *
 * Opens a dialog asking for a free-text reason, POSTs to the revoke endpoint,
 * shows a toast on success, then refreshes the route so the row updates.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';

export function RevokeButton({ grantId, customerLabel }: { grantId: string; customerLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 2) return toast.error('Provide a reason');
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/signup-bonus/grants/${grantId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      });
      if (!r.ok) return toast.error('Revoke failed: ' + (await r.text()));
      const data = await r.json().catch(() => ({}));
      toast.success(
        data?.voidedAmount > 0
          ? `Revoked — ₹${data.voidedAmount} voided`
          : 'Grant revoked'
      );
      setOpen(false);
      setReason('');
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <ShieldAlert className="size-3.5" /> Revoke
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke signup bonus</DialogTitle>
            <DialogDescription>
              Permanently invalidates the remaining balance for <strong>{customerLabel}</strong>.
              This action is audited and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Reason *</Label>
            <Textarea
              rows={3}
              placeholder="e.g. duplicate sign-up from same household, abuse pattern, fraud flag…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Written into the audit log and the customer's ledger note.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={submit} disabled={busy || reason.trim().length < 2}>
              {busy ? 'Revoking…' : 'Revoke grant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
