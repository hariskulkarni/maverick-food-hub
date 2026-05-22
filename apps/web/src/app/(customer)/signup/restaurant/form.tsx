'use client';
/**
 * Restaurant onboarding wizard.
 *
 * Five steps:
 *   1. Account   — owner name, email, password
 *   2. Identity  — restaurant name, cuisine, tagline, description, logo, cover
 *   3. Location  — first branch address, lat/lng, operating hours
 *   4. Menu      — three starter items with photos (≥ 1 to enable submit)
 *   5. Submit    — review + confetti celebration on success
 *
 * State is persisted to localStorage so the user can resume.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ImageUploader } from '@/components/image-uploader';
import { toast } from 'sonner';
import {
  User, ChefHat, MapPin, Utensils, CheckCircle2,
  ChevronRight, ChevronLeft, Sparkles, ExternalLink, Plus, Trash2, Lock, Mail, Copy
} from 'lucide-react';
import { QrCard } from '@/components/qr-card';

interface MenuItem { name: string; description: string; price: number; isVeg: boolean; imageUrl: string }
interface Hours { dayOfWeek: number; openMin: number; closeMin: number; closed: boolean }

const STORAGE_KEY = 'foodhub:onboarding:v2';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_HOURS: Hours[] = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openMin: 11 * 60, closeMin: 23 * 60, closed: false }));

const STEPS = [
  { key: 'account',  title: 'Account',      icon: User,     description: 'Create your owner login.' },
  { key: 'identity', title: 'Identity',     icon: ChefHat,  description: 'Tell customers about your kitchen.' },
  { key: 'location', title: 'Location',     icon: MapPin,   description: 'Address and opening hours.' },
  { key: 'menu',     title: 'First menu',   icon: Utensils, description: 'Add a few star dishes with photos.' },
  { key: 'review',   title: 'Submit',       icon: Sparkles, description: 'Send your application for approval.' }
] as const;

type FormData = {
  ownerName: string; ownerEmail: string; ownerPassword: string;
  restaurantName: string; cuisine: string; tagline: string; description: string;
  contactEmail: string; contactPhone: string;
  logoUrl: string; coverImageUrl: string;
  branchName: string; line1: string; city: string; state: string; postalCode: string;
  latitude: number | null; longitude: number | null;
  hours: Hours[];
  menuItems: MenuItem[];
};

const INITIAL: FormData = {
  ownerName: '', ownerEmail: '', ownerPassword: '',
  restaurantName: '', cuisine: '', tagline: '', description: '',
  contactEmail: '', contactPhone: '',
  logoUrl: '', coverImageUrl: '',
  branchName: '', line1: '', city: '', state: '', postalCode: '',
  latitude: null, longitude: null,
  hours: DEFAULT_HOURS,
  menuItems: [
    { name: '', description: '', price: 0, isVeg: true, imageUrl: '' }
  ]
};

function minutesToTime(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function timeToMinutes(s: string) { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); }

export function RestaurantSignupForm() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<{ slug: string; email: string } | null>(null);

  // Hydrate from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        setData({ ...INITIAL, ...stored.data });
        if (typeof stored.step === 'number') setStep(stored.step);
      }
    } catch {}
  }, []);

  // Persist on every change. Don't store password.
  useEffect(() => {
    try {
      const { ownerPassword, ...safe } = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data: safe }));
    } catch {}
  }, [step, data]);

  function update<K extends keyof FormData>(k: K, v: FormData[K]) { setData((p) => ({ ...p, [k]: v })); }

  // ─── per-step validation ───
  const canProceed = useMemo(() => {
    if (step === 0) return !!data.ownerName.trim() && /\S+@\S+\.\S+/.test(data.ownerEmail) && data.ownerPassword.length >= 8;
    if (step === 1) return !!data.restaurantName.trim();
    if (step === 2) return !!data.branchName.trim() && !!data.line1.trim() && !!data.city.trim() && !!data.postalCode.trim();
    if (step === 3) return data.menuItems.some((m) => m.name.trim() && m.price > 0);
    return true;
  }, [step, data]);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        ...data,
        menuItems: data.menuItems.filter((m) => m.name.trim() && m.price > 0)
      };
      const r = await fetch('/api/signup/restaurant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(await r.text());
      const result = await r.json();
      setSubmitted({ slug: result.slug, email: data.ownerEmail });
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    } catch (e) {
      toast.error((e as Error).message || 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) return <SuccessScreen email={submitted.email} slug={submitted.slug} />;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <ProgressHeader step={step} setStep={(s) => s <= step && setStep(s)} />

        <div className="p-6 md:p-8 reveal" key={step}>
          {step === 0 && <StepAccount data={data} update={update} />}
          {step === 1 && <StepIdentity data={data} update={update} />}
          {step === 2 && <StepLocation data={data} update={update} />}
          {step === 3 && <StepMenu data={data} update={update} />}
          {step === 4 && <StepReview data={data} />}
        </div>

        <div className="border-t bg-muted/20 p-4 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
          >
            <ChevronLeft className="size-4" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed} className="tap-press">
              Continue <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy} size="lg" className="tap-press">
              {busy ? 'Submitting…' : <><Sparkles className="size-4" /> Submit for approval</>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── progress header ────────────────────────────────────────────────────────
function ProgressHeader({ step, setStep }: { step: number; setStep: (s: number) => void }) {
  const pct = ((step + 1) / STEPS.length) * 100;
  return (
    <div className="border-b bg-gradient-to-br from-primary/5 via-card to-card p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              disabled={i > step}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-saffron'
                : done ? 'bg-success/15 text-success hover:bg-success/25'
                : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : <Icon className="size-3.5" />}
              <span className="hidden sm:inline">{s.title}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          );
        })}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-primary via-warning to-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3">
        <div className="display text-xl font-semibold">{STEPS[step].title}</div>
        <div className="text-xs text-muted-foreground">{STEPS[step].description}</div>
      </div>
    </div>
  );
}

// ─── Step 1: Account ────────────────────────────────────────────────────────
function StepAccount({ data, update }: { data: FormData; update: <K extends keyof FormData>(k: K, v: FormData[K]) => void }) {
  return (
    <div className="space-y-4 max-w-xl reveal-stagger">
      <div className="rounded-lg border bg-success/5 border-success/30 p-3 text-xs flex items-start gap-2">
        <Lock className="size-4 text-success mt-0.5 shrink-0" />
        <div><strong>You are creating an owner account.</strong> Your password is hashed with Argon2id. You'll sign in with this email after approval.</div>
      </div>
      <Field label="Your name *" required>
        <Input value={data.ownerName} onChange={(e) => update('ownerName', e.target.value)} placeholder="e.g. Priya Sharma" autoFocus />
      </Field>
      <Field label="Email *" required>
        <Input type="email" value={data.ownerEmail} onChange={(e) => update('ownerEmail', e.target.value)} placeholder="you@yourrestaurant.com" />
      </Field>
      <Field label="Password (min 8 characters) *" required>
        <Input type="password" value={data.ownerPassword} onChange={(e) => update('ownerPassword', e.target.value)} placeholder="Choose a strong password" />
        <PasswordStrength value={data.ownerPassword} />
      </Field>
    </div>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const score = Math.min(4, [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/, /.{12,}/].reduce((n, r) => n + (r.test(value) ? 1 : 0), 0));
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-primary', 'bg-success'];
  if (!value) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex-1 grid grid-cols-4 gap-1">
        {[0,1,2,3].map((i) => (
          <div key={i} className={`h-1 rounded-full ${i < score ? colors[score] : 'bg-muted'}`} />
        ))}
      </div>
      <span className={`text-[10px] font-medium ${score >= 3 ? 'text-success' : score >= 2 ? 'text-warning' : 'text-destructive'}`}>{labels[score]}</span>
    </div>
  );
}

// ─── Step 2: Identity ───────────────────────────────────────────────────────
function StepIdentity({ data, update }: { data: FormData; update: <K extends keyof FormData>(k: K, v: FormData[K]) => void }) {
  return (
    <div className="space-y-5 reveal-stagger">
      {/* Live preview */}
      <div className="relative overflow-hidden rounded-xl border bg-muted">
        <div className="relative h-32 bg-muted">
          {data.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground/40 text-xs">Cover image preview</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end gap-3 text-white">
            {data.logoUrl && (
              <div className="size-14 rounded-xl overflow-hidden border-2 border-white shadow-lg shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.logoUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <div>
              <div className="display font-semibold text-xl leading-tight">{data.restaurantName || 'Your restaurant name'}</div>
              {data.tagline && <div className="text-sm opacity-90 line-clamp-1">{data.tagline}</div>}
              {data.cuisine && <Badge className="mt-1 bg-white/15 text-white border-white/25 backdrop-blur">{data.cuisine}</Badge>}
            </div>
          </div>
        </div>
        <div className="px-4 py-2 text-[11px] text-muted-foreground">This is what customers will see on your restaurant page.</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Restaurant name *" required className="md:col-span-2">
          <Input value={data.restaurantName} onChange={(e) => update('restaurantName', e.target.value)} placeholder="The Saffron Kitchen" />
        </Field>
        <Field label="Cuisine">
          <Input value={data.cuisine} onChange={(e) => update('cuisine', e.target.value)} placeholder="North Indian, Italian…" />
        </Field>
        <Field label="Tagline">
          <Input value={data.tagline} onChange={(e) => update('tagline', e.target.value)} placeholder="Home-style cooking, delivered fast." />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea value={data.description} onChange={(e) => update('description', e.target.value)} rows={3} placeholder="Tell customers what makes your kitchen special." />
        </Field>
        <Field label="Contact email">
          <Input type="email" value={data.contactEmail} onChange={(e) => update('contactEmail', e.target.value)} />
        </Field>
        <Field label="Contact phone">
          <Input value={data.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} placeholder="+91…" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <ImageUploader
          value={data.logoUrl}
          onChange={(url) => update('logoUrl', url ?? '')}
          folder="signup/logos"
          aspect="square"
          label="Logo"
          hint="Square. ≥ 400px."
        />
        <ImageUploader
          value={data.coverImageUrl}
          onChange={(url) => update('coverImageUrl', url ?? '')}
          folder="signup/covers"
          aspect="wide"
          label="Cover image"
          hint="Wide hero shot of your food, restaurant, or team."
        />
      </div>
    </div>
  );
}

// ─── Step 3: Location + hours ───────────────────────────────────────────────
function StepLocation({ data, update }: { data: FormData; update: <K extends keyof FormData>(k: K, v: FormData[K]) => void }) {
  function updateDay(d: number, patch: Partial<Hours>) {
    update('hours', data.hours.map((h) => (h.dayOfWeek === d ? { ...h, ...patch } : h)));
  }
  const gmapsQuery = encodeURIComponent(`${data.line1} ${data.city} ${data.postalCode}`);
  return (
    <div className="space-y-5 reveal-stagger">
      <Field label="Branch name *" required>
        <Input value={data.branchName} onChange={(e) => update('branchName', e.target.value)} placeholder="HSR Layout, Indiranagar, Connaught Place…" />
      </Field>
      <Field label="Address line *" required>
        <Input value={data.line1} onChange={(e) => update('line1', e.target.value)} placeholder="22, 7th Main Road, Sector 6" />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="City *" required><Input value={data.city} onChange={(e) => update('city', e.target.value)} /></Field>
        <Field label="State"><Input value={data.state} onChange={(e) => update('state', e.target.value)} /></Field>
        <Field label="PIN code *" required><Input value={data.postalCode} onChange={(e) => update('postalCode', e.target.value)} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Latitude">
          <Input type="number" step="any" value={data.latitude ?? ''} onChange={(e) => update('latitude', e.target.value === '' ? null : Number(e.target.value))} placeholder="12.9716" />
        </Field>
        <Field label="Longitude">
          <Input type="number" step="any" value={data.longitude ?? ''} onChange={(e) => update('longitude', e.target.value === '' ? null : Number(e.target.value))} placeholder="77.5946" />
        </Field>
        <div className="self-end">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Find on Google Maps <ExternalLink className="size-3.5" />
          </a>
          <p className="text-[11px] text-muted-foreground mt-0.5">Right-click your pin → copy coordinates.</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="font-medium text-sm mb-3">Operating hours</div>
        <div className="space-y-2">
          {data.hours.map((h) => (
            <div key={h.dayOfWeek} className="flex items-center gap-3 text-sm">
              <div className="w-12 font-medium">{DAY_NAMES[h.dayOfWeek]}</div>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={!h.closed} onCheckedChange={(v) => updateDay(h.dayOfWeek, { closed: !v })} />
                <span className="w-12">{h.closed ? 'Closed' : 'Open'}</span>
              </label>
              {!h.closed ? (
                <>
                  <Input type="time" value={minutesToTime(h.openMin)} onChange={(e) => updateDay(h.dayOfWeek, { openMin: timeToMinutes(e.target.value) })} className="h-9 w-28" />
                  <span className="text-muted-foreground">to</span>
                  <Input type="time" value={minutesToTime(h.closeMin)} onChange={(e) => updateDay(h.dayOfWeek, { closeMin: timeToMinutes(e.target.value) })} className="h-9 w-28" />
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No orders accepted</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Menu items ─────────────────────────────────────────────────────
function StepMenu({ data, update }: { data: FormData; update: <K extends keyof FormData>(k: K, v: FormData[K]) => void }) {
  function addItem() { update('menuItems', [...data.menuItems, { name: '', description: '', price: 0, isVeg: true, imageUrl: '' }]); }
  function removeItem(i: number) { update('menuItems', data.menuItems.filter((_, idx) => idx !== i)); }
  function patchItem(i: number, patch: Partial<MenuItem>) { update('menuItems', data.menuItems.map((m, idx) => idx === i ? { ...m, ...patch } : m)); }
  const validCount = data.menuItems.filter((m) => m.name.trim() && m.price > 0).length;
  return (
    <div className="space-y-4 reveal-stagger">
      <div className="rounded-lg border bg-primary/5 border-primary/30 p-3 text-xs flex items-start gap-2">
        <Utensils className="size-4 text-primary mt-0.5 shrink-0" />
        <div>
          <strong>Add at least one signature dish to launch your menu.</strong> You can add the full menu after approval —
          this is just so customers see real dishes when your page goes live.
        </div>
      </div>

      <div className="space-y-3">
        {data.menuItems.map((m, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="grid gap-4 md:grid-cols-[140px_1fr] items-start">
              <ImageUploader
                value={m.imageUrl}
                onChange={(url) => patchItem(i, { imageUrl: url ?? '' })}
                folder="signup/menu-items"
                aspect="square"
                label={`Photo ${i + 1}`}
              />
              <div className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <Input value={m.name} onChange={(e) => patchItem(i, { name: e.target.value })} placeholder={`Dish ${i + 1} — e.g. Butter Chicken`} className="flex-1" />
                  {data.menuItems.length > 1 && (
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(i)} aria-label="Remove dish">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <Input value={m.description} onChange={(e) => patchItem(i, { description: e.target.value })} placeholder="Short description (optional)" />
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-[180px]">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                    <Input type="number" min={0} step={1} value={m.price || ''} onChange={(e) => patchItem(i, { price: Number(e.target.value) })} placeholder="299" className="pl-7" />
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <Switch checked={m.isVeg} onCheckedChange={(v) => patchItem(i, { isVeg: v })} />
                    <span className={`size-3.5 rounded-sm border-2 ${m.isVeg ? 'border-success' : 'border-destructive'}`}>
                      <span className={`block m-auto h-1.5 w-1.5 mt-1 rounded-full ${m.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                    </span>
                    <span className={m.isVeg ? 'text-success font-medium' : 'text-destructive font-medium'}>{m.isVeg ? 'Veg' : 'Non-veg'}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addItem}><Plus className="size-4" /> Add another dish</Button>
        <div className="text-xs text-muted-foreground">{validCount} {validCount === 1 ? 'dish' : 'dishes'} ready</div>
      </div>
    </div>
  );
}

// ─── Step 5: Review + submit ────────────────────────────────────────────────
function StepReview({ data }: { data: FormData }) {
  const validItems = data.menuItems.filter((m) => m.name.trim() && m.price > 0);
  return (
    <div className="space-y-5 reveal-stagger">
      <p className="text-sm text-muted-foreground">Final check before sending your application. Once approved you'll be able to edit everything from your admin dashboard.</p>

      <Section title="Owner">
        <Pair label="Name"  value={data.ownerName} />
        <Pair label="Email" value={data.ownerEmail} icon={Mail} />
        <Pair label="Password" value="• • • • • • • •" />
      </Section>

      <Section title="Restaurant">
        <Pair label="Name" value={data.restaurantName} />
        {data.cuisine && <Pair label="Cuisine" value={data.cuisine} />}
        {data.tagline && <Pair label="Tagline" value={data.tagline} />}
        {data.contactEmail && <Pair label="Contact email" value={data.contactEmail} />}
        {data.contactPhone && <Pair label="Contact phone" value={data.contactPhone} />}
      </Section>

      <Section title="Branch">
        <Pair label="Name" value={data.branchName} />
        <Pair label="Address" value={`${data.line1}, ${data.city} ${data.state} ${data.postalCode}`.replace(/\s+/g, ' ').trim()} />
        {data.latitude != null && data.longitude != null && <Pair label="Coordinates" value={`${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`} />}
        <Pair label="Hours" value={data.hours.filter((h) => !h.closed).length === 0 ? 'Closed every day (please update)' : `${data.hours.filter((h) => !h.closed).length} days/week`} />
      </Section>

      <Section title={`Starting menu (${validItems.length})`}>
        <div className="grid gap-2 md:grid-cols-2">
          {validItems.map((m, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-card">
                {m.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.imageUrl} alt="" className="h-full w-full object-cover" />
                  : <div className="grid place-items-center h-full text-[10px] text-muted-foreground">No img</div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.name}</div>
                <div className="text-xs text-muted-foreground">₹{m.price} · {m.isVeg ? 'Veg' : 'Non-veg'}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="rounded-lg border bg-success/5 border-success/30 p-3 text-xs flex items-start gap-2">
        <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" />
        <div>
          <strong>Almost there.</strong> Submitting puts your restaurant in review. Our team typically approves within ~1 business day.
          You'll get an email at <strong>{data.ownerEmail}</strong> the moment you're live.
        </div>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────
function Field({ label, children, required, className = '' }: { label: string; children: React.ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Pair({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {Icon && <Icon className="size-3.5 text-muted-foreground shrink-0" />}
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

// ─── success screen ─────────────────────────────────────────────────────────
function SuccessScreen({ email, slug }: { email: string; slug: string }) {
  // Compute the absolute URLs on the client so we show the actual host the
  // owner visited (works equally on staging/preview/production).
  const [origin, setOrigin] = useState<string>('');
  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
    // Cleanup any persisted state
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const customerUrl = `${origin}/r/${slug}`;
  const staffUrl = `${origin}/r/${slug}/staff`;

  return (
    <Card className="overflow-hidden border-success/40">
      <CardContent className="p-0">
        <Confetti />
        <div className="bg-gradient-to-br from-success/10 via-card to-warning/10 p-10 text-center">
          <div className="inline-grid size-20 place-items-center rounded-full bg-success text-success-foreground shadow-2xl shadow-success/40 burst">
            <CheckCircle2 className="size-10" />
          </div>
          <h1 className="display mt-6 text-3xl font-semibold">Application received! 🎉</h1>
          <p className="mt-2 max-w-md mx-auto text-muted-foreground">
            We've got everything we need. Our team will review your restaurant within ~1 business day.
          </p>

          <div className="mt-6 inline-flex flex-col sm:flex-row items-center gap-3 rounded-xl border bg-card p-4 text-left text-sm">
            <Mail className="size-5 text-primary shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Check your inbox</div>
              <div className="text-xs text-muted-foreground">We'll email <span className="font-mono">{email}</span> when you're approved.</div>
            </div>
          </div>

          {/* Share these URLs — customer-facing page and staff sign-in.
              Side-by-side QR cards: one to print for diners, one to bookmark for staff. */}
          <div className="mt-6 max-w-2xl mx-auto text-left">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Your restaurant URLs</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {origin && <QrCard url={customerUrl} label="Share this with customers" />}
              {origin && <QrCard url={staffUrl} label="Bookmark this for your team" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Print the QR poster, stick it on the counter, customers scan to order. Staff use the second URL to sign in to the dashboard.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`/r/${slug}/staff`}>Sign in to admin</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/r/${slug}`}>Preview your page</Link>
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Your restaurant page slug is <code className="font-mono bg-muted px-1.5 py-0.5 rounded">/r/{slug}</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} URL copied`);
    } catch {
      toast.error('Copy failed');
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className="font-mono text-xs truncate">{url || '…'}</div>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={copy} disabled={!url} aria-label={`Copy ${label} URL`}>
        <Copy className="size-3.5" />
        <span className="hidden sm:inline ml-1">Copy</span>
      </Button>
    </div>
  );
}

function Confetti() {
  const colors = ['#f23e5c', '#ff7aa0', '#16a34a', '#3a73c1', '#c026d3'];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    i,
    left: Math.random() * 100,
    dx: (Math.random() - 0.5) * 320,
    delay: Math.random() * 600,
    color: colors[i % colors.length],
    rot: Math.random() * 360
  }));
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`, top: '-10vh', background: p.color,
            transform: `rotate(${p.rot}deg)`, animationDelay: `${p.delay}ms`,
            // @ts-expect-error CSS custom property
            '--dx': `${p.dx}px`
          }}
        />
      ))}
    </div>
  );
}
