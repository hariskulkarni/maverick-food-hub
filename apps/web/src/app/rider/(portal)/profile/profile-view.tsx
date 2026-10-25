'use client';
/**
 * Profile — name/email (PATCH /api/rider/profile), photo (POST
 * /api/rider/avatar), emergency contacts (/api/rider/emergency-contacts) and
 * sign out. The phone number is the login identity, so it is read-only here.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, LogOut, Phone, Plus, Star, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { riderApi } from '../../_lib/api';
import type { EmergencyContact } from '../../_lib/types';
import { ErrorPanel, PageHeader, Panel, inputCls, useLoad } from '../../_components/bits';
import { signOut } from '../../_components/portal-shell';

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export function ProfileView({
  initial,
}: {
  initial: {
    name: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    riderType: 'FLEET' | 'DEDICATED' | null;
    dedicatedRestaurant: string | null;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [avatar, setAvatar] = useState(initial.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Enter your name.');
    setSaving(true);
    try {
      await riderApi('/api/rider/profile', { method: 'PATCH', body: { name: name.trim(), email: email.trim() || null } });
      toast.success('Profile saved.');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(file: File | undefined) {
    if (!file) return;
    if (file.type && !AVATAR_TYPES.includes(file.type)) return toast.error('Use a JPG, PNG or WebP photo.');
    if (file.size > 8 * 1024 * 1024) return toast.error('The photo is too large (max 8 MB).');
    const form = new FormData();
    form.append('photo', file);
    setUploading(true);
    try {
      const r = await riderApi<{ avatarUrl: string }>('/api/rider/avatar', { method: 'POST', form });
      setAvatar(r.avatarUrl);
      toast.success('Photo updated.');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Your details">
          <div className="mb-4 flex items-center gap-4">
            <div className="relative">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="Your profile photo" className="size-20 rounded-full object-cover" />
              ) : (
                <span className="grid size-20 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="size-8" />
                </span>
              )}
            </div>
            <div className="space-y-1">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Camera />} Change photo
              </Button>
              <input ref={fileRef} type="file" accept={AVATAR_TYPES.join(',')} className="sr-only" aria-label="Choose a profile photo" onChange={(e) => onAvatar(e.target.files?.[0])} />
              <p className="text-xs text-muted-foreground">
                {initial.riderType === 'DEDICATED' && initial.dedicatedRestaurant ? `Dedicated rider · ${initial.dedicatedRestaurant}` : 'Fleet rider'}
              </p>
            </div>
          </div>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label htmlFor="pf-name">Name</Label>
              <input id="pf-name" className={cn(inputCls, 'mt-1')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </div>
            <div>
              <Label htmlFor="pf-email">Email (optional)</Label>
              <input id="pf-email" type="email" className={cn(inputCls, 'mt-1')} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="pf-phone">Phone (sign-in number)</Label>
              <input id="pf-phone" className={cn(inputCls, 'mt-1 bg-muted')} value={initial.phone ?? ''} readOnly aria-readonly />
              <p className="mt-1 text-xs text-muted-foreground">To change your number, contact Flavrly rider support.</p>
            </div>
            <Button type="submit" className="min-h-11" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Save
            </Button>
          </form>
        </Panel>
        <EmergencyContacts />
      </div>
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Signing out ends this web session. Sign in again in the app to keep taking deliveries.</p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await signOut();
            }}
          >
            {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function EmergencyContacts() {
  const list = useLoad(() => riderApi<{ contacts: EmergencyContact[] }>('/api/rider/emergency-contacts'));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', relation: '', isPrimary: false });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Enter a name.');
    if (!/^\+?[\d\s().-]{6,20}$/.test(form.phone.trim())) return toast.error('Enter a valid phone number.');
    setBusy('new');
    try {
      await riderApi('/api/rider/emergency-contacts', {
        method: 'POST',
        body: { name: form.name.trim(), phone: form.phone.trim(), relation: form.relation.trim() || null, isPrimary: form.isPrimary },
      });
      toast.success('Contact added.');
      setForm({ name: '', phone: '', relation: '', isPrimary: false });
      setAdding(false);
      await list.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function makePrimary(c: EmergencyContact) {
    setBusy(c.id);
    try {
      await riderApi(`/api/rider/emergency-contacts/${c.id}`, { method: 'PATCH', body: { isPrimary: true } });
      await list.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: EmergencyContact) {
    if (!window.confirm(`Remove ${c.name} from your emergency contacts?`)) return;
    setBusy(c.id);
    try {
      await riderApi(`/api/rider/emergency-contacts/${c.id}`, { method: 'DELETE' });
      toast.success('Contact removed.');
      await list.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Emergency contacts"
      action={
        !adding && (
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        )
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">We alert your primary contact when you press SOS in the app.</p>
      {list.error ? (
        <ErrorPanel message={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Skeleton className="h-16" />
      ) : (list.data?.contacts ?? []).length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No emergency contacts yet. Add someone we can call if something goes wrong.</p>
      ) : (
        <ul className="space-y-2">
          {list.data!.contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium">
                  {c.name}
                  {c.isPrimary && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Primary</span>}
                </div>
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <Phone className="size-3.5" /> {c.phone}
                  {c.relation ? ` · ${c.relation}` : ''}
                </a>
              </div>
              {!c.isPrimary && (
                <Button size="sm" variant="ghost" className="min-h-11" disabled={busy === c.id} onClick={() => makePrimary(c)}>
                  <Star /> Make primary
                </Button>
              )}
              <Button size="sm" variant="ghost" className="min-h-11 text-destructive" disabled={busy === c.id} onClick={() => remove(c)} aria-label={`Remove ${c.name}`}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={add} className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ec-name">Name</Label>
              <input id="ec-name" className={cn(inputCls, 'mt-1')} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ec-phone">Phone</Label>
              <input id="ec-phone" type="tel" className={cn(inputCls, 'mt-1')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91…" />
            </div>
          </div>
          <div>
            <Label htmlFor="ec-rel">Relation (optional)</Label>
            <input id="ec-rel" className={cn(inputCls, 'mt-1')} value={form.relation} maxLength={40} onChange={(e) => setForm({ ...form, relation: e.target.value })} placeholder="e.g. Brother" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
            Make this my primary contact
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-11" disabled={busy === 'new'}>
              {busy === 'new' && <Loader2 className="animate-spin" />} Save contact
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
