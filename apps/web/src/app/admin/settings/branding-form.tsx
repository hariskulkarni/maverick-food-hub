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
import type { StorefrontConfig, HeroWidth, HeroHeight, HeroFit, HeroPosition, LogoFit, LogoShape } from '@/server/storefront-cms';
import {
  HERO_WIDTHS, HERO_WIDTH_LABELS, HERO_HEIGHTS, HERO_HEIGHT_LABELS,
  HERO_FITS, HERO_FIT_LABELS, HERO_POSITIONS, HERO_POSITION_LABELS,
  LOGO_FITS, LOGO_FIT_LABELS, LOGO_SHAPES, LOGO_SHAPE_LABELS,
} from '@/server/storefront-cms';

const SELECT_CLS = 'w-full rounded-md border border-input bg-background px-3 h-10 text-sm focus:outline-none focus:border-primary';

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

export function BrandingForm({ restaurant, initialConfig }: { restaurant: Restaurant; initialConfig: StorefrontConfig }) {
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
  const [cfg, setCfg] = useState<StorefrontConfig>(initialConfig);
  const setHero = (patch: Partial<StorefrontConfig['hero']>) => setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setLogo = (patch: Partial<StorefrontConfig['branding']['logoDisplay']>) =>
    setCfg((c) => ({ ...c, branding: { ...c.branding, logoDisplay: { ...c.branding.logoDisplay, ...patch } } }));

  function set<K extends keyof typeof f>(k: K, v: string) { setF((p) => ({ ...p, [k]: v })); }

  async function save() {
    setBusy(true);
    try {
      // Save identity/images AND the hero+logo layout (the latter lives in the
      // storefront CMS config). We send the FULL config so untouched sections
      // (announcement, blocks, info bar, etc.) are preserved.
      const [r1, r2] = await Promise.all([
        fetch('/api/admin/settings/branding', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }),
        fetch('/api/admin/storefront', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) }),
      ]);
      if (!r1.ok) { await reportApiError(r1, 'Save failed'); return; }
      if (!r2.ok) { await reportApiError(r2, 'Hero/logo save failed'); return; }
      toast.success('Branding & layout saved');
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
          <p className="text-[11px] text-muted-foreground">Brand-wide support number shown to customers on your storefront. (Each branch also has its own phone under Branches.)</p>
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

      <div className="rounded-xl border p-4 space-y-4">
        <div>
          <div className="text-sm font-semibold">Hero &amp; logo display</div>
          <p className="text-xs text-muted-foreground">How your cover image and logo render at the top of your page. Saved with the button below.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Hero width">
            <select value={cfg.hero.width} onChange={(e) => setHero({ width: e.target.value as HeroWidth })} className={SELECT_CLS}>
              {HERO_WIDTHS.map((w) => <option key={w} value={w}>{HERO_WIDTH_LABELS[w]}</option>)}
            </select>
          </Field>
          <Field label="Hero height">
            <select value={cfg.hero.height} onChange={(e) => setHero({ height: e.target.value as HeroHeight })} className={SELECT_CLS}>
              {HERO_HEIGHTS.map((h) => <option key={h} value={h}>{HERO_HEIGHT_LABELS[h]}</option>)}
            </select>
          </Field>
          <Field label="Hero image fit">
            <select value={cfg.hero.imageFit} onChange={(e) => setHero({ imageFit: e.target.value as HeroFit })} className={SELECT_CLS}>
              {HERO_FITS.map((x) => <option key={x} value={x}>{HERO_FIT_LABELS[x]}</option>)}
            </select>
          </Field>
          <Field label="Hero focal position">
            <select value={cfg.hero.imagePosition} onChange={(e) => setHero({ imagePosition: e.target.value as HeroPosition })} className={SELECT_CLS}>
              {HERO_POSITIONS.map((x) => <option key={x} value={x}>{HERO_POSITION_LABELS[x]}</option>)}
            </select>
          </Field>
          <Field label="Logo fit (fill / cover / contain)">
            <select value={cfg.branding.logoDisplay.fit} onChange={(e) => setLogo({ fit: e.target.value as LogoFit })} className={SELECT_CLS}>
              {LOGO_FITS.map((x) => <option key={x} value={x}>{LOGO_FIT_LABELS[x]}</option>)}
            </select>
          </Field>
          <Field label="Logo shape">
            <select value={cfg.branding.logoDisplay.shape} onChange={(e) => setLogo({ shape: e.target.value as LogoShape })} className={SELECT_CLS}>
              {LOGO_SHAPES.map((x) => <option key={x} value={x}>{LOGO_SHAPE_LABELS[x]}</option>)}
            </select>
          </Field>
          <Field label={`Logo padding — ${cfg.branding.logoDisplay.padding}px`}>
            <Input type="number" min={0} max={24} value={cfg.branding.logoDisplay.padding}
              onChange={(e) => setLogo({ padding: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })} />
          </Field>
          <Field label="Logo background">
            <input type="color" value={cfg.branding.logoDisplay.background || '#ffffff'}
              onChange={(e) => setLogo({ background: e.target.value })}
              className="h-10 w-full rounded-md border border-input bg-background p-1" />
          </Field>
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
