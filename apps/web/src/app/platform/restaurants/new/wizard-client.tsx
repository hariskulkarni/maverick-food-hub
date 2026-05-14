'use client';
/**
 * Super-admin "create restaurant" wizard — 6-step state machine.
 *
 * State lives entirely in a single `useReducer`. We persist a draft to
 * sessionStorage so an accidental tab close doesn't lose progress, and clear
 * it on a successful launch.
 *
 * Validation is *per-step*: clicking "Next" only advances if the section's
 * validate() returns no issues. Step 6 (Review) re-runs every step's
 * validation before enabling the final "Launch" button.
 */
import { useEffect, useMemo, useReducer, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ImageUploader } from '@/components/image-uploader';
import {
  ArrowLeft, ArrowRight, Check, Copy, Plus, Trash2, Loader2, PartyPopper, Sparkles, Pencil
} from 'lucide-react';
import { RESERVED_RESTAURANT_SLUGS, generateTempPassword } from '@/server/restaurant-wizard';
import { slugifyName } from '@/server/brands';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandLite { id: string; name: string; slug: string; tagline: string | null }
interface AdminLite { id: string; email: string | null; name: string | null }
interface Defaults {
  commissionPct: number;
  country: string;
  serviceRadiusKm: number;
  taxRatePct: number;
  baseDeliveryFee: number;
  perKmDeliveryFee: number;
}

interface IdentityState {
  name: string;
  slug: string;
  slugManuallyEdited: boolean;
  cuisine: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  contactEmail: string;
  contactPhone: string;
  commissionPct: number;
}
interface BrandState {
  mode: 'solo' | 'existing' | 'new';
  existingBrandId: string;
  newBrandName: string;
  newBrandSlug: string;
  newBrandTagline: string;
}
interface BranchState {
  name: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: string;
  longitude: string;
  serviceRadiusKm: number;
  taxRatePct: number;
  baseDeliveryFee: number;
  perKmDeliveryFee: number;
}
interface StaffRow { id: string; role: 'ADMIN' | 'KITCHEN'; email: string; name: string; tempPassword: string }
interface RiderRow { id: string; phone: string; name: string; vehicleType: 'BIKE' | 'SCOOTER' | 'BICYCLE'; vehicleNumber: string }

interface WizardState {
  step: number;
  identity: IdentityState;
  brand: BrandState;
  branch: BranchState;
  staff: StaffRow[];
  riders: RiderRow[];
  seedStarterMenu: boolean;
}

const STEPS = [
  { n: 1, label: 'Identity' },
  { n: 2, label: 'Brand' },
  { n: 3, label: 'First branch' },
  { n: 4, label: 'Staff' },
  { n: 5, label: 'Riders' },
  { n: 6, label: 'Review' }
] as const;

const SESSION_KEY = 'wizard:restaurant:draft';

// ─── Reducer ────────────────────────────────────────────────────────────────

type Action =
  | { type: 'goto'; step: number }
  | { type: 'identity'; patch: Partial<IdentityState> }
  | { type: 'brand'; patch: Partial<BrandState> }
  | { type: 'branch'; patch: Partial<BranchState> }
  | { type: 'staff:add'; row: StaffRow }
  | { type: 'staff:update'; id: string; patch: Partial<StaffRow> }
  | { type: 'staff:remove'; id: string }
  | { type: 'rider:add'; row: RiderRow }
  | { type: 'rider:update'; id: string; patch: Partial<RiderRow> }
  | { type: 'rider:remove'; id: string }
  | { type: 'seedMenu'; value: boolean }
  | { type: 'replace'; state: WizardState };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'goto':
      return { ...state, step: Math.max(1, Math.min(STEPS.length, action.step)) };
    case 'identity': {
      const patch = { ...action.patch };
      // Auto-derive slug from name unless the user explicitly typed in the slug field.
      if (patch.name !== undefined && !state.identity.slugManuallyEdited) {
        (patch as Partial<IdentityState>).slug = slugifyName(patch.name);
      }
      return { ...state, identity: { ...state.identity, ...patch } };
    }
    case 'brand':
      return { ...state, brand: { ...state.brand, ...action.patch } };
    case 'branch':
      return { ...state, branch: { ...state.branch, ...action.patch } };
    case 'staff:add':
      return { ...state, staff: [...state.staff, action.row] };
    case 'staff:update':
      return {
        ...state,
        staff: state.staff.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s))
      };
    case 'staff:remove':
      return { ...state, staff: state.staff.filter((s) => s.id !== action.id) };
    case 'rider:add':
      return { ...state, riders: [...state.riders, action.row] };
    case 'rider:update':
      return {
        ...state,
        riders: state.riders.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r))
      };
    case 'rider:remove':
      return { ...state, riders: state.riders.filter((r) => r.id !== action.id) };
    case 'seedMenu':
      return { ...state, seedStarterMenu: action.value };
    case 'replace':
      return action.state;
    default:
      return state;
  }
}

function initialState(defaults: Defaults): WizardState {
  return {
    step: 1,
    identity: {
      name: '',
      slug: '',
      slugManuallyEdited: false,
      cuisine: '',
      tagline: '',
      description: '',
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: '',
      contactPhone: '',
      commissionPct: defaults.commissionPct
    },
    brand: { mode: 'solo', existingBrandId: '', newBrandName: '', newBrandSlug: '', newBrandTagline: '' },
    branch: {
      name: 'Main branch',
      line1: '',
      city: '',
      state: '',
      postalCode: '',
      country: defaults.country,
      latitude: '',
      longitude: '',
      serviceRadiusKm: defaults.serviceRadiusKm,
      taxRatePct: defaults.taxRatePct,
      baseDeliveryFee: defaults.baseDeliveryFee,
      perKmDeliveryFee: defaults.perKmDeliveryFee
    },
    staff: [
      { id: 'admin-1', role: 'ADMIN', email: '', name: '', tempPassword: generateTempPassword() },
      { id: 'kitchen-1', role: 'KITCHEN', email: '', name: '', tempPassword: generateTempPassword() }
    ],
    riders: [],
    seedStarterMenu: true
  };
}

// ─── Per-step validators ────────────────────────────────────────────────────

function validateIdentity(s: IdentityState): string[] {
  const issues: string[] = [];
  if (!s.name.trim() || s.name.trim().length < 2) issues.push('Restaurant name is required.');
  const slug = slugifyName(s.slug || s.name);
  if (!slug || slug.length < 2) issues.push('Slug is invalid.');
  if (RESERVED_RESTAURANT_SLUGS.has(slug)) issues.push(`Slug "${slug}" is reserved — pick another.`);
  if (s.commissionPct < 0 || s.commissionPct > 100) issues.push('Commission % must be 0–100.');
  if (s.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail)) issues.push('Contact email is invalid.');
  return issues;
}

function validateBrand(s: BrandState): string[] {
  const issues: string[] = [];
  if (s.mode === 'existing' && !s.existingBrandId) issues.push('Pick an existing brand or change the mode.');
  if (s.mode === 'new') {
    if (!s.newBrandName.trim() || s.newBrandName.trim().length < 2) issues.push('New brand name is required.');
    const slug = slugifyName(s.newBrandSlug || s.newBrandName);
    if (!slug || slug.length < 2) issues.push('New brand slug is invalid.');
  }
  return issues;
}

function validateBranch(s: BranchState): string[] {
  const issues: string[] = [];
  if (!s.name.trim()) issues.push('Branch name is required.');
  if (!s.line1.trim()) issues.push('Address line 1 is required.');
  if (!s.city.trim()) issues.push('City is required.');
  if (!s.postalCode.trim()) issues.push('Postal code is required.');
  const lat = Number(s.latitude);
  const lng = Number(s.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) issues.push('Longitude must be between -180 and 180.');
  if (s.serviceRadiusKm <= 0) issues.push('Service radius must be > 0.');
  if (s.taxRatePct < 0 || s.taxRatePct > 40) issues.push('Tax rate must be 0–40%.');
  if (s.baseDeliveryFee < 0) issues.push('Base delivery fee must be ≥ 0.');
  if (s.perKmDeliveryFee < 0) issues.push('Per-km delivery fee must be ≥ 0.');
  return issues;
}

function validateStaff(rows: StaffRow[]): string[] {
  const issues: string[] = [];
  const admins = rows.filter((r) => r.role === 'ADMIN');
  const kitchens = rows.filter((r) => r.role === 'KITCHEN');
  if (admins.length !== 1) issues.push('Exactly one Admin row is required.');
  if (kitchens.length < 1) issues.push('At least one Kitchen user is required.');
  const emails = new Set<string>();
  for (const r of rows) {
    if (!r.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
      issues.push(`${r.role}: email is invalid.`);
    } else {
      const e = r.email.toLowerCase();
      if (emails.has(e)) issues.push(`Email "${e}" is used by more than one staff row.`);
      emails.add(e);
    }
    if (!r.tempPassword || r.tempPassword.length < 8) issues.push(`${r.role}: temp password must be ≥ 8 chars.`);
  }
  return issues;
}

function validateRiders(rows: RiderRow[]): string[] {
  const issues: string[] = [];
  const phones = new Set<string>();
  for (const r of rows) {
    if (!r.phone.trim() || r.phone.trim().length < 6) issues.push('Rider phone is too short.');
    if (phones.has(r.phone.trim())) issues.push(`Phone "${r.phone}" is duplicated.`);
    phones.add(r.phone.trim());
    if (!['BIKE', 'SCOOTER', 'BICYCLE'].includes(r.vehicleType)) issues.push('Pick a vehicle type.');
  }
  return issues;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function WizardClient({ brands, unownedAdmins, defaults }: { brands: BrandLite[]; unownedAdmins: AdminLite[]; defaults: Defaults }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, defaults, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<null | { restaurantId: string; slug: string; brandId: string | null; adminCredentials: { email: string; tempPassword: string }; kitchenCredentials: { email: string; tempPassword: string }[] }>(null);

  // Restore draft on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WizardState;
        // Naive shape sanity check — if a developer changes the schema, drop
        // stale drafts silently rather than crash.
        if (parsed && typeof parsed === 'object' && parsed.identity && parsed.branch) {
          dispatch({ type: 'replace', state: parsed });
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft.
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const issues = useMemo(() => ({
    1: validateIdentity(state.identity),
    2: validateBrand(state.brand),
    3: validateBranch(state.branch),
    4: validateStaff(state.staff),
    5: validateRiders(state.riders)
  }), [state]);

  const allIssues = useMemo(() => [
    ...issues[1], ...issues[2], ...issues[3], ...issues[4], ...issues[5]
  ], [issues]);

  function next() {
    const stepIssues = (issues as any)[state.step] as string[] | undefined;
    if (stepIssues && stepIssues.length > 0) {
      toast.error(stepIssues[0]);
      return;
    }
    dispatch({ type: 'goto', step: state.step + 1 });
  }

  function back() {
    dispatch({ type: 'goto', step: state.step - 1 });
  }

  async function launch() {
    if (allIssues.length > 0) {
      toast.error('Please fix the validation issues before launching.');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        identity: {
          name: state.identity.name,
          slug: state.identity.slug || undefined,
          cuisine: state.identity.cuisine || null,
          tagline: state.identity.tagline || null,
          description: state.identity.description || null,
          logoUrl: state.identity.logoUrl,
          coverImageUrl: state.identity.coverImageUrl,
          contactEmail: state.identity.contactEmail || null,
          contactPhone: state.identity.contactPhone || null,
          commissionPct: state.identity.commissionPct
        },
        brand: state.brand.mode === 'solo'
          ? { mode: 'solo' as const }
          : state.brand.mode === 'existing'
            ? { mode: 'existing' as const, brandId: state.brand.existingBrandId }
            : { mode: 'new' as const, name: state.brand.newBrandName, slug: state.brand.newBrandSlug || undefined, tagline: state.brand.newBrandTagline || null },
        branch: {
          name: state.branch.name,
          line1: state.branch.line1,
          city: state.branch.city,
          state: state.branch.state || null,
          postalCode: state.branch.postalCode,
          country: state.branch.country || 'IN',
          latitude: Number(state.branch.latitude),
          longitude: Number(state.branch.longitude),
          serviceRadiusKm: state.branch.serviceRadiusKm,
          taxRatePct: state.branch.taxRatePct,
          baseDeliveryFee: state.branch.baseDeliveryFee,
          perKmDeliveryFee: state.branch.perKmDeliveryFee
        },
        staff: state.staff.map((s) => ({
          role: s.role,
          email: s.email.trim(),
          tempPassword: s.tempPassword,
          name: s.name || null
        })),
        riders: state.riders.map((r) => ({
          phone: r.phone.trim(),
          name: r.name || null,
          vehicleType: r.vehicleType,
          vehicleNumber: r.vehicleNumber || null
        })),
        seedStarterMenu: state.seedStarterMenu
      };

      const res = await fetch('/api/platform/restaurants/wizard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      setSuccess(data);
      toast.success('Restaurant launched!');
    } catch (e) {
      toast.error('Launch failed: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return <SuccessScreen result={success} onAgain={() => {
      setSuccess(null);
      dispatch({ type: 'replace', state: initialState(defaults) });
      router.refresh();
    }} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/platform/restaurants" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-4" /> All restaurants
          </Link>
          <h1 className="display text-3xl font-semibold leading-tight mt-1">New restaurant</h1>
          <p className="text-sm text-muted-foreground">Stand up a new tenant — identity, brand, first branch, staff and riders.</p>
        </div>
      </header>

      <Stepper current={state.step} onJump={(n) => dispatch({ type: 'goto', step: n })} issues={issues as any} />

      <Card>
        <CardContent className="p-6 space-y-6">
          {state.step === 1 && <IdentityStep state={state.identity} dispatch={dispatch} issues={issues[1]} />}
          {state.step === 2 && <BrandStep state={state.brand} brands={brands} dispatch={dispatch} issues={issues[2]} />}
          {state.step === 3 && <BranchStep state={state.branch} dispatch={dispatch} issues={issues[3]} />}
          {state.step === 4 && <StaffStep rows={state.staff} dispatch={dispatch} issues={issues[4]} />}
          {state.step === 5 && <RidersStep rows={state.riders} dispatch={dispatch} issues={issues[5]} />}
          {state.step === 6 && (
            <ReviewStep
              state={state}
              brands={brands}
              issues={allIssues}
              onEdit={(n) => dispatch({ type: 'goto', step: n })}
              onSeedToggle={(v) => dispatch({ type: 'seedMenu', value: v })}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={back} disabled={state.step === 1 || submitting}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {state.step < STEPS.length ? (
          <Button onClick={next}>Next <ArrowRight className="size-4" /></Button>
        ) : (
          <Button onClick={launch} disabled={submitting || allIssues.length > 0} size="lg" variant="success">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Launch restaurant
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function Stepper({ current, onJump, issues }: { current: number; onJump: (n: number) => void; issues: Record<number, string[]> }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s) => {
        const done = s.n < current && (issues[s.n]?.length ?? 0) === 0;
        const active = s.n === current;
        const hasIssue = s.n < current && (issues[s.n]?.length ?? 0) > 0;
        return (
          <li key={s.n}>
            <button
              onClick={() => onJump(s.n)}
              className={[
                'inline-flex items-center gap-2 px-3 h-8 rounded-full border transition-colors',
                active   ? 'border-primary bg-primary text-primary-foreground' :
                hasIssue ? 'border-destructive text-destructive bg-destructive/5' :
                done     ? 'border-success text-success bg-success/5' :
                           'border-muted text-muted-foreground'
              ].join(' ')}
            >
              <span className="font-semibold">{s.n}</span>
              <span>{s.label}</span>
              {done && <Check className="size-3.5" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Identity ───────────────────────────────────────────────────────

function IdentityStep({ state, dispatch, issues }: { state: IdentityState; dispatch: React.Dispatch<Action>; issues: string[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2 space-y-1">
        <h2 className="font-semibold text-lg">Restaurant identity</h2>
        <p className="text-sm text-muted-foreground">How the restaurant shows up to customers and on reports.</p>
      </div>

      <div>
        <Label>Name *</Label>
        <Input value={state.name} onChange={(e) => dispatch({ type: 'identity', patch: { name: e.target.value } })} placeholder="Olive Bistro" />
      </div>
      <div>
        <Label>Slug *</Label>
        <Input
          value={state.slug}
          onChange={(e) => dispatch({ type: 'identity', patch: { slug: slugifyName(e.target.value), slugManuallyEdited: true } })}
          placeholder="olive-bistro"
        />
        <p className="text-[11px] text-muted-foreground mt-1">URL-safe. Reserved words ({Array.from(RESERVED_RESTAURANT_SLUGS).join(', ')}) are blocked.</p>
      </div>

      <div>
        <Label>Cuisine</Label>
        <Input value={state.cuisine} onChange={(e) => dispatch({ type: 'identity', patch: { cuisine: e.target.value } })} placeholder="Italian, Indian, Multi-cuisine…" />
      </div>
      <div>
        <Label>Commission % *</Label>
        <Input
          type="number"
          step="0.5"
          min={0}
          max={100}
          value={state.commissionPct}
          onChange={(e) => dispatch({ type: 'identity', patch: { commissionPct: Number(e.target.value) } })}
        />
      </div>

      <div className="md:col-span-2">
        <Label>Tagline</Label>
        <Input value={state.tagline} onChange={(e) => dispatch({ type: 'identity', patch: { tagline: e.target.value } })} placeholder="Authentic wood-fired pizzas in Koramangala" />
      </div>

      <div className="md:col-span-2">
        <Label>Description</Label>
        <Textarea
          value={state.description}
          onChange={(e) => dispatch({ type: 'identity', patch: { description: e.target.value } })}
          rows={3}
          placeholder="A short paragraph customers will read on the storefront."
        />
      </div>

      <div>
        <Label>Logo</Label>
        <ImageUploader value={state.logoUrl ?? null} onChange={(url) => dispatch({ type: 'identity', patch: { logoUrl: url } })} folder="restaurants" aspect="square" />
      </div>
      <div>
        <Label>Cover image</Label>
        <ImageUploader value={state.coverImageUrl ?? null} onChange={(url) => dispatch({ type: 'identity', patch: { coverImageUrl: url } })} folder="restaurants" aspect="wide" />
      </div>

      <div>
        <Label>Contact email</Label>
        <Input value={state.contactEmail} onChange={(e) => dispatch({ type: 'identity', patch: { contactEmail: e.target.value } })} placeholder="hello@olivebistro.in" />
      </div>
      <div>
        <Label>Contact phone</Label>
        <Input value={state.contactPhone} onChange={(e) => dispatch({ type: 'identity', patch: { contactPhone: e.target.value } })} placeholder="+91 98765 43210" />
      </div>

      <IssueList issues={issues} />
    </div>
  );
}

// ─── Step 2: Brand ──────────────────────────────────────────────────────────

function BrandStep({ state, brands, dispatch, issues }: { state: BrandState; brands: BrandLite[]; dispatch: React.Dispatch<Action>; issues: string[] }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">Brand assignment</h2>
        <p className="text-sm text-muted-foreground">A solo restaurant stands on its own. An umbrella brand groups multiple cuisines under one hospitality group.</p>
      </div>

      <div className="grid gap-3">
        <RadioCard
          name="brand-mode"
          value="solo"
          current={state.mode}
          label="Solo restaurant"
          hint="No umbrella brand — this is the default for independent restaurants."
          onSelect={() => dispatch({ type: 'brand', patch: { mode: 'solo' } })}
        />
        <RadioCard
          name="brand-mode"
          value="existing"
          current={state.mode}
          label="Part of an existing umbrella"
          hint="Attach to a brand already on the platform."
          onSelect={() => dispatch({ type: 'brand', patch: { mode: 'existing' } })}
        >
          {state.mode === 'existing' && (
            <div className="mt-3 grid gap-2 max-h-64 overflow-auto pr-1">
              {brands.length === 0 && (
                <p className="text-xs text-muted-foreground">No brands exist yet. Create a new one above or skip.</p>
              )}
              {brands.map((b) => (
                <label key={b.id} className="flex items-start gap-2 text-sm rounded-md border p-2 hover:bg-accent/30 cursor-pointer">
                  <input
                    type="radio"
                    name="existing-brand"
                    checked={state.existingBrandId === b.id}
                    onChange={() => dispatch({ type: 'brand', patch: { existingBrandId: b.id } })}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground"> · /{b.slug}</span>
                    {b.tagline && <span className="block text-xs text-muted-foreground">{b.tagline}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </RadioCard>
        <RadioCard
          name="brand-mode"
          value="new"
          current={state.mode}
          label="Create a new umbrella brand"
          hint="Spin up a new Brand row alongside this restaurant. You can re-use it for future cuisines."
          onSelect={() => dispatch({ type: 'brand', patch: { mode: 'new' } })}
        >
          {state.mode === 'new' && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <Label>Brand name</Label>
                <Input
                  value={state.newBrandName}
                  onChange={(e) => dispatch({ type: 'brand', patch: { newBrandName: e.target.value, newBrandSlug: slugifyName(e.target.value) } })}
                  placeholder="Goan Hospitality"
                />
              </div>
              <div>
                <Label>Brand slug</Label>
                <Input
                  value={state.newBrandSlug}
                  onChange={(e) => dispatch({ type: 'brand', patch: { newBrandSlug: slugifyName(e.target.value) } })}
                  placeholder="goan-hospitality"
                />
              </div>
              <div className="md:col-span-2">
                <Label>Tagline</Label>
                <Input value={state.newBrandTagline} onChange={(e) => dispatch({ type: 'brand', patch: { newBrandTagline: e.target.value } })} placeholder="Hospitality group spanning 4 cuisines" />
              </div>
            </div>
          )}
        </RadioCard>
      </div>

      <IssueList issues={issues} />
    </div>
  );
}

function RadioCard({ name, value, current, label, hint, onSelect, children }: { name: string; value: string; current: string; label: string; hint: string; onSelect: () => void; children?: React.ReactNode }) {
  const active = current === value;
  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-accent/30'}`}
    >
      <div className="flex items-start gap-3">
        <input type="radio" name={name} value={value} checked={active} onChange={onSelect} className="mt-1" />
        <div className="flex-1">
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Step 3: Branch ─────────────────────────────────────────────────────────

function BranchStep({ state, dispatch, issues }: { state: BranchState; dispatch: React.Dispatch<Action>; issues: string[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2 space-y-1">
        <h2 className="font-semibold text-lg">First branch</h2>
        <p className="text-sm text-muted-foreground">Address, geo, and the cost rates customers will see at checkout. You can add more branches later from the admin console.</p>
      </div>

      <div className="md:col-span-2">
        <Label>Branch name *</Label>
        <Input value={state.name} onChange={(e) => dispatch({ type: 'branch', patch: { name: e.target.value } })} placeholder="Main branch" />
      </div>

      <div className="md:col-span-2">
        <Label>Address line 1 *</Label>
        <Input value={state.line1} onChange={(e) => dispatch({ type: 'branch', patch: { line1: e.target.value } })} placeholder="123 80ft Road" />
      </div>

      <div>
        <Label>City *</Label>
        <Input value={state.city} onChange={(e) => dispatch({ type: 'branch', patch: { city: e.target.value } })} placeholder="Bengaluru" />
      </div>
      <div>
        <Label>State</Label>
        <Input value={state.state} onChange={(e) => dispatch({ type: 'branch', patch: { state: e.target.value } })} placeholder="Karnataka" />
      </div>
      <div>
        <Label>Postal code *</Label>
        <Input value={state.postalCode} onChange={(e) => dispatch({ type: 'branch', patch: { postalCode: e.target.value } })} placeholder="560034" />
      </div>
      <div>
        <Label>Country</Label>
        <Input value={state.country} onChange={(e) => dispatch({ type: 'branch', patch: { country: e.target.value } })} placeholder="IN" />
      </div>

      <div>
        <Label>Latitude *</Label>
        <Input value={state.latitude} onChange={(e) => dispatch({ type: 'branch', patch: { latitude: e.target.value } })} placeholder="12.9352" inputMode="decimal" />
      </div>
      <div>
        <Label>Longitude *</Label>
        <Input value={state.longitude} onChange={(e) => dispatch({ type: 'branch', patch: { longitude: e.target.value } })} placeholder="77.6245" inputMode="decimal" />
      </div>
      <div className="md:col-span-2 text-xs text-muted-foreground -mt-3">
        Tip: paste a Google Maps pin to populate both. A visual picker is on the roadmap.
      </div>

      <div>
        <Label>Service radius (km)</Label>
        <Input type="number" step="0.5" min={0.5} max={50} value={state.serviceRadiusKm}
               onChange={(e) => dispatch({ type: 'branch', patch: { serviceRadiusKm: Number(e.target.value) } })} />
      </div>
      <div>
        <Label>Tax rate (%)</Label>
        <Input type="number" step="0.5" min={0} max={40} value={state.taxRatePct}
               onChange={(e) => dispatch({ type: 'branch', patch: { taxRatePct: Number(e.target.value) } })} />
      </div>
      <div>
        <Label>Base delivery fee (₹)</Label>
        <Input type="number" step="1" min={0} value={state.baseDeliveryFee}
               onChange={(e) => dispatch({ type: 'branch', patch: { baseDeliveryFee: Number(e.target.value) } })} />
      </div>
      <div>
        <Label>Per-km delivery fee (₹)</Label>
        <Input type="number" step="0.5" min={0} value={state.perKmDeliveryFee}
               onChange={(e) => dispatch({ type: 'branch', patch: { perKmDeliveryFee: Number(e.target.value) } })} />
      </div>

      <IssueList issues={issues} />
    </div>
  );
}

// ─── Step 4: Staff ──────────────────────────────────────────────────────────

function StaffStep({ rows, dispatch, issues }: { rows: StaffRow[]; dispatch: React.Dispatch<Action>; issues: string[] }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">Staff accounts</h2>
        <p className="text-sm text-muted-foreground">One Restaurant Admin (owner-level) and at least one Kitchen user are required. Temp passwords are generated for you — copy them before launching.</p>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="p-4 grid gap-3 md:grid-cols-[160px_1fr_1fr_auto]">
              <div>
                <Label>Role</Label>
                <div className="h-10 inline-flex items-center text-sm font-medium">
                  <Badge variant={row.role === 'ADMIN' ? 'default' : 'muted'}>{row.role}</Badge>
                </div>
              </div>
              <div>
                <Label>Email *</Label>
                <Input value={row.email} onChange={(e) => dispatch({ type: 'staff:update', id: row.id, patch: { email: e.target.value } })} placeholder={row.role === 'ADMIN' ? 'admin@restaurant.com' : 'kitchen@restaurant.com'} />
              </div>
              <div>
                <Label>Temp password</Label>
                <PasswordField value={row.tempPassword} onRegenerate={() => dispatch({ type: 'staff:update', id: row.id, patch: { tempPassword: generateTempPassword() } })} />
              </div>
              <div className="self-end">
                {row.role === 'KITCHEN' && rows.filter((r) => r.role === 'KITCHEN').length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => dispatch({ type: 'staff:remove', id: row.id })}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => dispatch({
          type: 'staff:add',
          row: { id: `kitchen-${Date.now()}`, role: 'KITCHEN', email: '', name: '', tempPassword: generateTempPassword() }
        })}
      >
        <Plus className="size-4" /> Add another kitchen user
      </Button>

      <IssueList issues={issues} />
    </div>
  );
}

function PasswordField({ value, onRegenerate }: { value: string; onRegenerate: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input value={value} readOnly className="font-mono text-sm" />
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => toast.success('Copied'));
        }}
      >
        <Copy className="size-3.5" /> Copy
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={onRegenerate} title="Regenerate">
        <Sparkles className="size-3.5" />
      </Button>
    </div>
  );
}

// ─── Step 5: Riders ─────────────────────────────────────────────────────────

function RidersStep({ rows, dispatch, issues }: { rows: RiderRow[]; dispatch: React.Dispatch<Action>; issues: string[] }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">Starter riders <span className="text-muted-foreground font-normal">(optional)</span></h2>
        <p className="text-sm text-muted-foreground">
          Pre-create some delivery rider accounts. KYC happens later — riders won't be able to claim live orders until a super-admin approves their documents.
        </p>
      </div>

      {rows.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No riders yet. Skip this step if you'd rather onboard them through the rider sign-up flow.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <div>
                <Label>Phone *</Label>
                <Input value={row.phone} onChange={(e) => dispatch({ type: 'rider:update', id: row.id, patch: { phone: e.target.value } })} placeholder="+91 99000 11122" />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={row.name} onChange={(e) => dispatch({ type: 'rider:update', id: row.id, patch: { name: e.target.value } })} placeholder="Ravi" />
              </div>
              <div>
                <Label>Vehicle</Label>
                <div className="h-10 inline-flex items-center gap-3">
                  {(['BIKE', 'SCOOTER', 'BICYCLE'] as const).map((v) => (
                    <label key={v} className="inline-flex items-center gap-1 text-xs">
                      <input type="radio" name={`vt-${row.id}`} checked={row.vehicleType === v} onChange={() => dispatch({ type: 'rider:update', id: row.id, patch: { vehicleType: v } })} />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Vehicle number</Label>
                <Input value={row.vehicleNumber} onChange={(e) => dispatch({ type: 'rider:update', id: row.id, patch: { vehicleNumber: e.target.value } })} placeholder="KA01AB1234" />
              </div>
              <div className="self-end">
                <Button variant="ghost" size="icon" onClick={() => dispatch({ type: 'rider:remove', id: row.id })}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => dispatch({
          type: 'rider:add',
          row: { id: `rider-${Date.now()}`, phone: '', name: '', vehicleType: 'BIKE', vehicleNumber: '' }
        })}
      >
        <Plus className="size-4" /> Add rider
      </Button>

      <IssueList issues={issues} />
    </div>
  );
}

// ─── Step 6: Review ─────────────────────────────────────────────────────────

function ReviewStep({ state, brands, issues, onEdit, onSeedToggle }: {
  state: WizardState;
  brands: BrandLite[];
  issues: string[];
  onEdit: (n: number) => void;
  onSeedToggle: (v: boolean) => void;
}) {
  const brandLabel = state.brand.mode === 'solo' ? 'Solo restaurant' :
    state.brand.mode === 'new' ? `New brand: ${state.brand.newBrandName}` :
    `Existing brand: ${brands.find((b) => b.id === state.brand.existingBrandId)?.name ?? '(none picked)'}`;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">Review</h2>
        <p className="text-sm text-muted-foreground">One last look before we provision everything.</p>
      </div>

      <SummaryCard step={1} title="Identity" onEdit={onEdit}>
        <SummaryRow label="Name"  value={state.identity.name} />
        <SummaryRow label="Slug"  value={`/${state.identity.slug}`} />
        <SummaryRow label="Cuisine" value={state.identity.cuisine || '—'} />
        <SummaryRow label="Commission %" value={`${state.identity.commissionPct}%`} />
        <SummaryRow label="Contact" value={[state.identity.contactEmail, state.identity.contactPhone].filter(Boolean).join(' · ') || '—'} />
      </SummaryCard>

      <SummaryCard step={2} title="Brand" onEdit={onEdit}>
        <SummaryRow label="Mode" value={brandLabel} />
        {state.brand.mode === 'new' && <SummaryRow label="Slug" value={`/${state.brand.newBrandSlug}`} />}
      </SummaryCard>

      <SummaryCard step={3} title="First branch" onEdit={onEdit}>
        <SummaryRow label="Name" value={state.branch.name} />
        <SummaryRow label="Address" value={`${state.branch.line1}, ${state.branch.city}, ${state.branch.state || ''} ${state.branch.postalCode}, ${state.branch.country}`} />
        <SummaryRow label="Coords" value={`${state.branch.latitude}, ${state.branch.longitude}`} />
        <SummaryRow label="Service radius" value={`${state.branch.serviceRadiusKm} km`} />
        <SummaryRow label="Tax / Delivery" value={`Tax ${state.branch.taxRatePct}% · Base ₹${state.branch.baseDeliveryFee} · ₹${state.branch.perKmDeliveryFee}/km`} />
      </SummaryCard>

      <SummaryCard step={4} title="Staff" onEdit={onEdit}>
        {state.staff.map((s) => (
          <SummaryRow key={s.id} label={s.role} value={s.email} />
        ))}
      </SummaryCard>

      <SummaryCard step={5} title="Starter riders" onEdit={onEdit}>
        {state.riders.length === 0
          ? <SummaryRow label="Riders" value="None — onboard them later" />
          : state.riders.map((r) => <SummaryRow key={r.id} label={r.vehicleType} value={`${r.name || '(unnamed)'} · ${r.phone}`} />)}
      </SummaryCard>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <input id="seed-menu" type="checkbox" checked={state.seedStarterMenu} onChange={(e) => onSeedToggle(e.target.checked)} />
          <label htmlFor="seed-menu" className="text-sm flex-1">
            Seed a starter menu (one category + three hidden placeholder items) so the public page isn't empty until the admin signs in.
          </label>
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card>
          <CardContent className="p-4 border-l-4 border-destructive">
            <div className="font-semibold text-destructive mb-2">Fix these before launching:</div>
            <ul className="list-disc list-inside text-sm text-destructive/90 space-y-0.5">
              {issues.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ step, title, children, onEdit }: { step: number; title: string; children: React.ReactNode; onEdit: (n: number) => void }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={() => onEdit(step)}><Pencil className="size-3.5" /> Edit</Button>
        </div>
        <dl className="text-sm grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">{children}</dl>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide w-28 shrink-0">{label}</dt>
      <dd className="font-medium truncate">{value}</dd>
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="md:col-span-2 rounded-md border-l-4 border-destructive bg-destructive/5 p-3">
      <ul className="list-disc list-inside text-sm text-destructive/90 space-y-0.5">
        {issues.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}

// ─── Success screen ─────────────────────────────────────────────────────────

function SuccessScreen({ result, onAgain }: { result: { restaurantId: string; slug: string; brandId: string | null; adminCredentials: { email: string; tempPassword: string }; kitchenCredentials: { email: string; tempPassword: string }[] }; onAgain: () => void }) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto py-8">
      <header className="text-center space-y-2">
        <div className="mx-auto inline-flex items-center justify-center size-16 rounded-full bg-success/15 text-success">
          <PartyPopper className="size-8" />
        </div>
        <h1 className="display text-3xl font-semibold">Restaurant launched</h1>
        <p className="text-sm text-muted-foreground">Share these credentials with the new admin. Temp passwords should be changed on first login.</p>
      </header>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Slug: </span>
            <span className="font-mono">/{result.slug}</span>
          </div>

          <CredentialRow role="ADMIN" email={result.adminCredentials.email} password={result.adminCredentials.tempPassword} />
          {result.kitchenCredentials.map((k, i) => (
            <CredentialRow key={i} role="KITCHEN" email={k.email} password={k.tempPassword} />
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/login" className="contents">
          <Button variant="default" className="w-full">Open admin login</Button>
        </Link>
        <Button variant="outline" onClick={onAgain}>Create another restaurant</Button>
      </div>

      <div className="text-center">
        <Link href={`/platform/restaurants`} className="text-sm text-muted-foreground hover:text-foreground">
          Back to restaurants list
        </Link>
      </div>
    </div>
  );
}

function CredentialRow({ role, email, password }: { role: string; email: string; password: string }) {
  return (
    <div className="rounded-md border p-3 grid grid-cols-1 md:grid-cols-[100px_1fr_1fr_auto] gap-2 items-center">
      <Badge variant={role === 'ADMIN' ? 'default' : 'muted'} className="w-fit">{role}</Badge>
      <div className="text-sm font-medium truncate">{email}</div>
      <div className="text-sm font-mono">{password}</div>
      <Button variant="outline" size="sm" type="button" onClick={() => {
        navigator.clipboard?.writeText(`${email} / ${password}`).then(() => toast.success('Copied'));
      }}><Copy className="size-3.5" /> Copy</Button>
    </div>
  );
}
