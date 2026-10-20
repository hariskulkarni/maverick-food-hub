'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ShieldAlert, Loader2, KeyRound } from 'lucide-react';

/**
 * Create super admin — deliberately separate from the platform-team
 * "Add member" form. Super admins hold every capability, so creation needs an
 * explicit confirm step. Calls POST /api/platform/iam/super-admins.
 */
export function SuperAdminCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setName(''); setEmail(''); setPassword('');
    setConfirming(false); setOpen(false);
  }

  function review(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) { toast.error('Password must be at least 12 characters.'); return; }
    setConfirming(true);
  }

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/platform/iam/super-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || data.detail || data.error || 'Could not create super admin.');
        setConfirming(false);
        return;
      }
      toast.success(`${data.user?.email ?? email} created as Super Admin.`);
      reset();
      router.refresh();
    } catch { toast.error('Network error creating super admin.'); }
    finally { setBusy(false); }
  }

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="size-5 mt-0.5 shrink-0 text-destructive" />
            <div>
              <h2 className="font-semibold">Create super admin</h2>
              <p className="text-sm text-muted-foreground">
                Highest privilege: full control of every business, user and setting. Only create accounts for people you fully trust.
              </p>
            </div>
          </div>
          <Button
            className="min-h-11 shrink-0"
            variant={open ? 'outline' : 'destructive'}
            onClick={() => (open ? reset() : setOpen(true))}
            disabled={busy}
          >
            {open ? 'Cancel' : 'New super admin'}
          </Button>
        </div>

        {open && !confirming && (
          <form onSubmit={review} className="mt-4 grid gap-3 md:grid-cols-2 border-t pt-4">
            <div>
              <label htmlFor="sa-name" className="text-xs font-medium text-muted-foreground">Full name</label>
              <Input id="sa-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="sa-email" className="text-xs font-medium text-muted-foreground">Email (login)</label>
              <Input id="sa-email" className="min-h-11" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="sa-pw" className="text-xs font-medium text-muted-foreground">Initial password</label>
              <div className="relative">
                <KeyRound className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="sa-pw" className="pl-8 min-h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} placeholder="min 12 characters" autoComplete="new-password" />
              </div>
            </div>
            <p className="md:col-span-2 text-xs text-muted-foreground">
              The new super-admin sets up Google Authenticator on first sign-in.
            </p>
            <div className="md:col-span-2">
              <Button type="submit" variant="destructive" className="min-h-11 w-full sm:w-auto">Review</Button>
            </div>
          </form>
        )}

        {open && confirming && (
          <div role="alertdialog" aria-label="Confirm super admin creation" className="mt-4 border-t pt-4 space-y-3">
            <p className="text-sm">
              You are about to grant <strong>full Super Admin access</strong> to{' '}
              <strong>{name}</strong> (<span className="break-all">{email}</span>). This is the highest privilege on the platform.
            </p>
            <p className="text-xs text-muted-foreground">
              The new super-admin sets up Google Authenticator on first sign-in.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="destructive" className="min-h-11" onClick={create} disabled={busy}>
                {busy && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                Yes, create super admin
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
