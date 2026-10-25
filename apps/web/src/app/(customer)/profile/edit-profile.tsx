'use client';
/** Customer self-service: edit name / email (PATCH /api/customer/me). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

export function EditProfile({ name, email, phone }: { name: string | null; email: string | null; phone: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(name ?? '');
  const [e, setE] = useState(email ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!n.trim()) return toast.error('Name cannot be empty.');
    setBusy(true);
    try {
      const r = await fetch('/api/customer/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n.trim(), email: e.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(d.error || 'Could not save your profile.');
      toast.success('Profile updated');
      setEditing(false);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Your details</h3>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>
          )}
        </div>
        {!editing ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Name</dt><dd className="truncate">{name || '—'}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-all">{email || '—'}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Phone</dt><dd className="truncate">{phone || '—'}</dd></div>
          </dl>
        ) : (
          <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
            <div>
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" value={n} onChange={(ev) => setN(ev.target.value)} maxLength={80} autoComplete="name" required />
            </div>
            <div>
              <Label htmlFor="profile-email">Email (optional)</Label>
              <Input id="profile-email" type="email" value={e} onChange={(ev) => setE(ev.target.value)} maxLength={160} autoComplete="email" />
            </div>
            <p className="text-xs text-muted-foreground">Your phone number is how you sign in and can&apos;t be changed here.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setN(name ?? ''); setE(email ?? ''); }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
