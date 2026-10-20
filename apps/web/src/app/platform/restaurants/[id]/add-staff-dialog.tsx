'use client';
/**
 * "Add staff" — SUPER_ADMIN adds an ADMIN or KITCHEN account (with an initial
 * password) to an existing restaurant. Posts to
 * /api/platform/restaurants/[id]/staff, which enforces SUPER_ADMIN server-side.
 * The password is only ever held in this form's state and is cleared on close.
 */
import * as React from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const MIN_PASSWORD = 12;

export function AddStaffDialog({ restaurantId, onAdded }: { restaurantId: string; onAdded?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [role, setRole] = React.useState<'ADMIN' | 'KITCHEN'>('KITCHEN');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  function reset() {
    setRole('KITCHEN');
    setName('');
    setEmail('');
    setPassword('');
  }

  const valid = name.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && password.length >= MIN_PASSWORD;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/restaurants/${restaurantId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.message ?? j.detail ?? 'Could not add staff');
        return;
      }
      toast.success(`${role === 'ADMIN' ? 'Admin' : 'Kitchen'} account created for ${j.user?.email ?? email.trim()}`);
      reset();
      setOpen(false);
      onAdded?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Add staff
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
            <DialogDescription>
              Create a sign-in for this restaurant. They&apos;ll set up Google Authenticator on first sign-in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3" autoComplete="off">
            <div className="space-y-1.5">
              <Label htmlFor="staff-role">Role</Label>
              <select
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'ADMIN' | 'KITCHEN')}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ADMIN">Admin</option>
                <option value="KITCHEN">Kitchen</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name</Label>
              <Input id="staff-name" className="h-11" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email</Label>
              <Input id="staff-email" className="h-11" type="email" value={email} maxLength={160} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Initial password</Label>
              <Input
                id="staff-password"
                className="h-11"
                type="password"
                autoComplete="new-password"
                value={password}
                minLength={MIN_PASSWORD}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters. Share it with them securely.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={!valid || busy}>
                {busy ? 'Adding…' : 'Add staff'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
