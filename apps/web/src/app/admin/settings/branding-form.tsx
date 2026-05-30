'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { Save, Image as ImageIcon } from 'lucide-react';
import { ImageUploader } from '@/components/image-uploader';

interface Restaurant {
  id: string;
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  cuisine?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
}

export function BrandingForm({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: restaurant.name,
    tagline: restaurant.tagline ?? '',
    description: restaurant.description ?? '',
    cuisine: restaurant.cuisine ?? '',
    contactEmail: restaurant.contactEmail ?? '',
    contactPhone: restaurant.contactPhone ?? '',
    logoUrl: restaurant.logoUrl ?? '',
    coverImageUrl: restaurant.coverImageUrl ?? ''
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: string) { setF((p) => ({ ...p, [k]: v })); }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/settings/branding', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
      toast.success('Branding saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Live preview strip */}
      <div className="relative overflow-hidden rounded-xl border bg-muted">
        <div className="relative h-32 bg-muted">
          {f.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              <ImageIcon className="size-6" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end gap-3 text-white">
            {f.logoUrl && (
              <div className="size-12 rounded-lg overflow-hidden border-2 border-white bg-card shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.logoUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <div>
              <div className="display font-semibold text-lg leading-tight">{f.name || 'Your restaurant name'}</div>
              {f.tagline && <div className="text-xs opacity-90 line-clamp-1">{f.tagline}</div>}
            </div>
          </div>
        </div>
        <div className="px-4 py-2 text-[11px] text-muted-foreground">Live preview · this is what customers see at <span className="font-mono">/r/{restaurant.slug}</span></div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name *">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Cuisine">
          <Input value={f.cuisine} onChange={(e) => set('cuisine', e.target.value)} placeholder="e.g. North Indian, Italian" />
        </Field>
        <Field label="Tagline" className="md:col-span-2">
          <Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="A short line shown under your name" />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <textarea
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
            placeholder="Tell customers what makes your kitchen special"
          />
        </Field>
        <Field label="Contact email">
          <Input type="email" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="hello@yourplace.com" />
        </Field>
        <Field label="Contact phone">
          <Input value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+91…" />
        </Field>
        <div className="md:col-span-2 grid gap-4 md:grid-cols-[180px_1fr]">
          <ImageUploader
            value={f.logoUrl}
            onChange={(url) => set('logoUrl', url ?? '')}
            folder={`restaurants/${restaurant.slug}/logo`}
            aspect="square"
            label="Logo"
            recommended="512×512 px (square) · transparent PNG preferred"
          />
          <ImageUploader
            value={f.coverImageUrl}
            onChange={(url) => set('coverImageUrl', url ?? '')}
            folder={`restaurants/${restaurant.slug}/cover`}
            aspect="wide"
            label="Cover image"
            recommended="1920×1080 px (16:9, landscape) · shown at the top of your restaurant page"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy || !f.name.trim()}>
          <Save className="size-4" /> {busy ? 'Saving…' : 'Save branding'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
