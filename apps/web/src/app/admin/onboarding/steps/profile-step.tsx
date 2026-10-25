'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ImageUploader } from '@/components/image-uploader';
import { validateEmail, validateHexColor, validateIndianPhone } from '@/lib/onboarding/validators';
import { StepFrame, Field, apiJson, useDebouncedSave, SampleItemCard } from '../parts';
import type { StepProps } from '../wizard-client';

interface ProfileForm {
  name: string; tagline: string; cuisine: string; description: string;
  contactPhone: string; contactEmail: string;
  logoUrl: string; coverImageUrl: string;
  accentColor: string; secondaryColor: string;
}

const PALETTES = [
  { label: 'Chilli red', accent: '#E23744', secondary: '#FF8A65' },
  { label: 'Saffron', accent: '#EA580C', secondary: '#FBBF24' },
  { label: 'Curry-leaf green', accent: '#15803D', secondary: '#A3E635' },
  { label: 'Midnight', accent: '#1E3A8A', secondary: '#38BDF8' },
];

export function ProfileStep({ data, draft, saveDraft, complete }: StepProps) {
  const r = data.restaurant;
  const initial: ProfileForm = {
    name: r.name, tagline: r.tagline ?? '', cuisine: r.cuisine ?? '', description: r.description ?? '',
    contactPhone: r.contactPhone ?? '', contactEmail: r.contactEmail ?? '',
    logoUrl: r.logoUrl ?? '', coverImageUrl: r.coverImageUrl ?? '',
    accentColor: data.storefront.branding.accentColor, secondaryColor: data.storefront.theme.secondaryColor,
  };
  const [f, setF] = useState<ProfileForm>({ ...initial, ...((draft as Partial<ProfileForm>) ?? {}) });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  useDebouncedSave(f, saveDraft);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const errors = useMemo(() => ({
    name: f.name.trim().length < 2 ? 'Your restaurant name needs at least 2 characters.' : null,
    contactPhone: validateIndianPhone(f.contactPhone, { required: true }),
    contactEmail: validateEmail(f.contactEmail),
    accentColor: validateHexColor(f.accentColor),
    secondaryColor: validateHexColor(f.secondaryColor),
  }), [f]);
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  async function save() {
    setTouched(true);
    if (hasErrors) { toast.error('Fix the highlighted fields first.'); return; }
    setBusy(true);
    const ok = await apiJson('/api/admin/settings/branding', 'PATCH', {
      name: f.name, tagline: f.tagline, description: f.description, cuisine: f.cuisine,
      contactEmail: f.contactEmail, contactPhone: f.contactPhone, logoUrl: f.logoUrl, coverImageUrl: f.coverImageUrl,
    }, 'Could not save your profile');
    const colorsChanged = f.accentColor !== initial.accentColor || f.secondaryColor !== initial.secondaryColor;
    const okColors = !ok || !colorsChanged ? true : await apiJson('/api/admin/storefront', 'PATCH', {
      config: {
        ...data.storefront,
        branding: { ...data.storefront.branding, accentColor: f.accentColor },
        theme: { ...data.storefront.theme, secondaryColor: f.secondaryColor },
      },
    }, 'Could not save your colours');
    setBusy(false);
    if (ok && okColors) {
      toast.success('Profile saved');
      await complete();
    }
  }

  return (
    <StepFrame
      title="Business profile & branding"
      intro="This is your shop window. Customers decide in seconds whether to tap — a clear name, a real phone number and a good photo do most of the work."
      why="Your phone number is how riders and customers reach you about an order, and your logo and colours appear on your storefront, order tracking and receipts."
      example={<>“<b>Spice Garden</b> · North Indian · <i>Slow-cooked curries from old Delhi family recipes</i> · +91 98765 43210”. Logo: a square PNG on a transparent background; cover: a bright, wide photo of your best-selling dish.</>}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Restaurant name" required error={show('name')} className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Spice Garden" />
          </Field>
          <Field label="Cuisine" hint="Shown as a tag. Example: North Indian, Chinese">
            <Input value={f.cuisine} onChange={(e) => set('cuisine', e.target.value)} placeholder="North Indian" />
          </Field>
          <Field label="Tagline" hint="One line, under 60 characters works best.">
            <Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={160} placeholder="Slow-cooked curries, delivered hot" />
          </Field>
          <Field label="About your restaurant" className="sm:col-span-2" hint="2–3 sentences: what you are known for, since when, what makes you different.">
            <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Family-run since 1998, we cook every gravy from scratch each morning…" />
          </Field>
          <Field label="Contact phone" required error={show('contactPhone')} hint="Example: +91 98765 43210">
            <Input inputMode="tel" value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} onBlur={() => setTouched(true)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Contact email" error={show('contactEmail')} hint="For order and payout emails. Example: orders@spicegarden.in">
            <Input type="email" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="orders@spicegarden.in" />
          </Field>
          <div className="sm:col-span-2 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <ImageUploader value={f.logoUrl} onChange={(u) => set('logoUrl', u ?? '')} folder="restaurants" aspect="square" label="Logo" recommended="512×512 px, square PNG" />
            <ImageUploader value={f.coverImageUrl} onChange={(u) => set('coverImageUrl', u ?? '')} folder="restaurants" aspect="wide" label="Cover photo" recommended="1920×1080 px, landscape" />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <div className="text-xs font-medium">Brand colours</div>
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((p) => {
                const active = p.accent.toLowerCase() === f.accentColor.toLowerCase();
                return (
                  <button key={p.label} type="button" onClick={() => setF((x) => ({ ...x, accentColor: p.accent, secondaryColor: p.secondary }))}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${active ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent'}`}>
                    <span className="size-4 rounded-full" style={{ background: p.accent }} />
                    <span className="size-4 -ml-3 rounded-full ring-2 ring-background" style={{ background: p.secondary }} />
                    {p.label} {active && <Check className="size-3" />}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Main colour (buttons, prices)" value={f.accentColor} onChange={(v) => set('accentColor', v)} error={errors.accentColor} />
              <ColorField label="Second colour (highlights)" value={f.secondaryColor} onChange={(v) => set('secondaryColor', v)} error={errors.secondaryColor} />
            </div>
          </div>
        </div>

        <aside className="space-y-2 lg:sticky lg:top-4 self-start">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live storefront preview</div>
          <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
            <div className="relative h-32 bg-muted">
              {f.coverImageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                : <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${f.accentColor}, ${f.secondaryColor})` }} />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2 text-white">
                <div className="size-12 shrink-0 overflow-hidden rounded-lg border-2 border-white bg-white">
                  {f.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.logoUrl} alt="" className="h-full w-full object-contain" />
                    : <div className="grid h-full place-items-center text-lg font-bold" style={{ color: f.accentColor }}>{(f.name || 'R').charAt(0)}</div>}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold leading-tight truncate">{f.name || 'Your restaurant'}</div>
                  {f.tagline && <div className="text-[11px] opacity-90 truncate">{f.tagline}</div>}
                </div>
              </div>
            </div>
            <div className="space-y-3 p-3">
              {f.cuisine && <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: f.accentColor }}>{f.cuisine}</span>}
              <SampleItemCard accent={f.accentColor} sample item={data.menu.recent[0] ?? { name: 'Paneer Butter Masala', description: 'Paneer in a buttery tomato-cashew gravy.', price: 280, isVeg: true }} />
              <div className="rounded-md py-2 text-center text-sm font-semibold text-white" style={{ background: f.accentColor }}>View cart</div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Preview only — exact layout follows your storefront settings.</p>
        </aside>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save & continue
        </Button>
      </div>
    </StepFrame>
  );
}

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error: string | null }) {
  return (
    <Field label={label} error={error}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-10 w-12 shrink-0 cursor-pointer rounded border bg-background p-1" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" placeholder="#E23744" />
      </div>
    </Field>
  );
}
