'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { Save, MapPin, ExternalLink, ChevronDown, ShieldCheck, AlertTriangle, FileCheck2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { BranchLocationChange } from '@/components/branch-location-picker';
// Load the Leaflet map picker client-side only — Leaflet references `window`,
// so server-rendering it crashes the Settings page ("window is not defined").
const BranchLocationPicker = dynamic(
  () => import('@/components/branch-location-picker').then((m) => m.BranchLocationPicker),
  { ssr: false, loading: () => <div className="h-[360px] w-full animate-pulse rounded-xl border bg-muted" /> }
);
import { ImageUploader } from '@/components/image-uploader';
import { licenseStatus, licenseStatusLabel } from '@/server/food-license';

interface Hours { dayOfWeek: number; openMin: number; closeMin: number }
interface Branch {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  email?: string | null;
  line1: string;
  city: string;
  state?: string | null;
  postalCode: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  serviceRadiusKm: number;
  taxRatePct: number;
  baseDeliveryFee: number | string;
  perKmDeliveryFee: number | string;
  packagingFee: number | string;
  isActive: boolean;
  hours: Hours[];
  // FSSAI food-license (all optional). Dates arrive as ISO strings via JSON.
  fssaiLicenseNumber?: string | null;
  fssaiLicenseHolder?: string | null;
  fssaiLicenseType?: string | null;
  fssaiLicenseAddress?: string | null;
  fssaiIssuedOn?: string | null;
  fssaiRenewedOn?: string | null;
  fssaiExpiresOn?: string | null;
  fssaiLicenseImageUrl?: string | null;
  fssaiLicenseNotes?: string | null;
}

/** ISO datetime string → 'YYYY-MM-DD' for a <input type="date">, or ''. */
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesToTime(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
}
function timeToMinutes(s: string) {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function BranchForm({ branch }: { branch: Branch }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: branch.name,
    phone: branch.phone ?? '',
    email: branch.email ?? '',
    line1: branch.line1,
    city: branch.city,
    state: branch.state ?? '',
    postalCode: branch.postalCode,
    country: branch.country ?? 'IN',
    latitude: branch.latitude ?? null as number | null,
    longitude: branch.longitude ?? null as number | null,
    serviceRadiusKm: branch.serviceRadiusKm,
    taxRatePct: branch.taxRatePct,
    baseDeliveryFee: Number(branch.baseDeliveryFee),
    perKmDeliveryFee: Number(branch.perKmDeliveryFee),
    packagingFee: Number(branch.packagingFee),
    isActive: branch.isActive,
    // FSSAI food-license
    fssaiLicenseNumber: branch.fssaiLicenseNumber ?? '',
    fssaiLicenseHolder: branch.fssaiLicenseHolder ?? '',
    fssaiLicenseType: branch.fssaiLicenseType ?? '',
    fssaiLicenseAddress: branch.fssaiLicenseAddress ?? '',
    fssaiIssuedOn: toDateInput(branch.fssaiIssuedOn),
    fssaiRenewedOn: toDateInput(branch.fssaiRenewedOn),
    fssaiExpiresOn: toDateInput(branch.fssaiExpiresOn),
    fssaiLicenseImageUrl: branch.fssaiLicenseImageUrl ?? (null as string | null),
    fssaiLicenseNotes: branch.fssaiLicenseNotes ?? ''
  });
  // Pre-fill hours: 7 days, defaulting closed if missing
  const initialHours: (Hours & { closed: boolean })[] = Array.from({ length: 7 }, (_, d) => {
    const h = branch.hours.find((x) => x.dayOfWeek === d);
    if (!h) return { dayOfWeek: d, openMin: 11 * 60, closeMin: 23 * 60, closed: true };
    return { dayOfWeek: d, openMin: h.openMin, closeMin: h.closeMin, closed: h.openMin === 0 && h.closeMin === 0 };
  });
  const [hours, setHours] = useState(initialHours);
  const [busy, setBusy] = useState(false);
  const hasCoords = branch.latitude != null && branch.longitude != null;
  const [mapOpen, setMapOpen] = useState(!hasCoords);
  const [applyAddress, setApplyAddress] = useState(false);

  function handleLocationChange(v: BranchLocationChange) {
    setF((p) => {
      const next: typeof p = { ...p, latitude: v.lat, longitude: v.lng };
      if (applyAddress) {
        if (v.line1) next.line1 = v.line1;
        if (v.city) next.city = v.city;
        if (v.state !== undefined) next.state = v.state;
        if (v.postalCode) next.postalCode = v.postalCode;
      }
      return next;
    });
  }

  function set<K extends keyof typeof f>(k: K, v: any) { setF((p) => ({ ...p, [k]: v })); }
  function updateDay(d: number, patch: Partial<(typeof hours)[number]>) {
    setHours((p) => p.map((x) => (x.dayOfWeek === d ? { ...x, ...patch } : x)));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/settings/branch/${branch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, hours })
      });
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
      toast.success(`${branch.name} saved`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const gmapsUrl = f.latitude && f.longitude
    ? `https://www.google.com/maps/?q=${f.latitude},${f.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.line1} ${f.city} ${f.postalCode}`)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <MapPin className="size-5" />
          </div>
          <div>
            <div className="font-semibold">{branch.name}</div>
            <div className="text-xs text-muted-foreground">{branch.slug}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor={`active-${branch.id}`} className="text-xs text-muted-foreground">Accepting orders</Label>
          <Switch id={`active-${branch.id}`} checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} />
        </div>
      </div>

      {/* Contact + address */}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Branch name">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <p className="text-[11px] text-muted-foreground">This location’s direct line (per branch). For the brand-wide support number shown on your storefront, use Branding → Contact phone.</p>
        </Field>
        <Field label="Address" className="md:col-span-2">
          <Input value={f.line1} onChange={(e) => set('line1', e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State / region">
          <Input value={f.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field label="Postal code">
          <Input value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
        </Field>
        <Field label="Country">
          <Input value={f.country} onChange={(e) => set('country', e.target.value)} maxLength={4} />
        </Field>

        <div className="md:col-span-2 rounded-lg border bg-card">
          <button
            type="button"
            onClick={() => setMapOpen((v) => !v)}
            className="tap-press flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium"
            aria-expanded={mapOpen}
          >
            <span>📍 Pin your location on the map</span>
            <ChevronDown className={`size-4 transition-transform ${mapOpen ? 'rotate-180' : ''}`} />
          </button>
          {mapOpen && (
            <div className="space-y-2 border-t p-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={applyAddress}
                  onChange={(e) => setApplyAddress(e.target.checked)}
                />
                Use reverse-geocoded address (overwrites address fields)
              </label>
              <BranchLocationPicker
                initial={f.latitude != null && f.longitude != null ? { lat: f.latitude, lng: f.longitude } : undefined}
                onChange={handleLocationChange}
              />
            </div>
          )}
        </div>

        <Field label="Latitude">
          {/* min/max guard so a stray digit doesn't dump the branch off the planet
              (no client-side bounds previously). Server-side validation still applies. */}
          <Input type="number" step="any" min={-90} max={90} value={f.latitude ?? ''} onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Longitude">
          <Input type="number" step="any" min={-180} max={180} value={f.longitude ?? ''} onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>

        <div className="md:col-span-2 text-xs text-muted-foreground flex items-center gap-3">
          <a href={gmapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Find on Google Maps <ExternalLink className="size-3" />
          </a>
          <span className="opacity-70">as a fallback if the pin picker can&apos;t find your spot.</span>
        </div>
      </div>

      {/* Service zone + fees */}
      <div className="grid gap-4 md:grid-cols-4 rounded-lg border bg-muted/30 p-4">
        <Field label="Delivery radius (km)">
          <Input type="number" step="0.5" min="0" value={f.serviceRadiusKm} onChange={(e) => set('serviceRadiusKm', Number(e.target.value || 0))} />
        </Field>
        <Field label="Tax rate (%)">
          <Input type="number" step="0.1" min="0" max="50" value={f.taxRatePct} onChange={(e) => set('taxRatePct', Number(e.target.value || 0))} />
        </Field>
        <Field label="Base delivery fee (₹)">
          <Input type="number" step="1" min="0" value={f.baseDeliveryFee} onChange={(e) => set('baseDeliveryFee', Number(e.target.value || 0))} />
        </Field>
        <Field label="Per-km delivery fee (₹)">
          <Input type="number" step="0.5" min="0" value={f.perKmDeliveryFee} onChange={(e) => set('perKmDeliveryFee', Number(e.target.value || 0))} />
        </Field>
        <Field label="Packaging fee (₹)">
          <Input type="number" step="1" min="0" value={f.packagingFee} onChange={(e) => set('packagingFee', Number(e.target.value || 0))} />
        </Field>
      </div>

      {/* Hours */}
      <div className="rounded-lg border bg-card p-4">
        <div className="font-medium text-sm mb-3">Operating hours</div>
        <div className="space-y-2">
          {hours.map((h) => (
            <div key={h.dayOfWeek} className="grid grid-cols-[80px_1fr] sm:grid-cols-[80px_auto_1fr_auto_1fr] items-center gap-3 text-sm">
              <div className="font-medium">{DAY_NAMES[h.dayOfWeek]}</div>
              <div className="flex items-center gap-2 sm:contents">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={!h.closed} onCheckedChange={(v) => updateDay(h.dayOfWeek, { closed: !v })} />
                  <span>{h.closed ? 'Closed' : 'Open'}</span>
                </label>
              </div>
              {!h.closed ? (
                <>
                  <Input
                    type="time"
                    value={minutesToTime(h.openMin)}
                    onChange={(e) => updateDay(h.dayOfWeek, { openMin: timeToMinutes(e.target.value) })}
                    className="h-9"
                  />
                  <span className="text-muted-foreground text-center">to</span>
                  <Input
                    type="time"
                    value={minutesToTime(h.closeMin)}
                    onChange={(e) => updateDay(h.dayOfWeek, { closeMin: timeToMinutes(e.target.value) })}
                    className="h-9"
                  />
                </>
              ) : (
                <div className="text-xs text-muted-foreground col-span-3">No orders accepted on this day.</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── FSSAI Food License ── */}
      <FoodLicenseSection f={f} set={set} />

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          <Save className="size-4" /> {busy ? 'Saving…' : 'Save branch'}
        </Button>
      </div>
    </div>
  );
}

/**
 * FSSAI food-license editor for a branch: number, holder, type, premises
 * address, the three lifecycle dates, a free-text notes box, and a photo of the
 * certificate. A live status pill mirrors what the public footer + alert sweep
 * compute, so the admin can see at a glance whether the licence is expiring.
 */
function FoodLicenseSection({
  f,
  set
}: {
  f: any;
  set: (k: any, v: any) => void;
}) {
  const status = licenseStatus(f.fssaiExpiresOn || null, Boolean(f.fssaiLicenseNumber));
  const pill =
    status.state === 'expired'
      ? 'bg-destructive/10 text-destructive border-destructive/30'
      : status.state === 'expiring'
        ? 'bg-warning/10 text-warning border-warning/30'
        : status.state === 'valid'
          ? 'bg-success/10 text-success border-success/30'
          : 'bg-muted text-muted-foreground border-border';
  const Icon = status.state === 'expired' || status.state === 'expiring' ? AlertTriangle : ShieldCheck;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium text-sm">
          <FileCheck2 className="size-4 text-primary" /> FSSAI food licence
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${pill}`}>
          <Icon className="size-3.5" />
          {licenseStatusLabel(status)}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Licence number">
          <Input
            value={f.fssaiLicenseNumber}
            onChange={(e) => set('fssaiLicenseNumber', e.target.value)}
            placeholder="e.g. 10118007000780"
            inputMode="numeric"
          />
        </Field>
        <Field label="Licence type">
          <select
            value={f.fssaiLicenseType}
            onChange={(e) => set('fssaiLicenseType', e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select…</option>
            <option value="Registration">Registration (Basic)</option>
            <option value="State">State Licence</option>
            <option value="Central">Central Licence</option>
          </select>
        </Field>
        <Field label="Licensee / business name" className="md:col-span-2">
          <Input
            value={f.fssaiLicenseHolder}
            onChange={(e) => set('fssaiLicenseHolder', e.target.value)}
            placeholder="Name as printed on the certificate"
          />
        </Field>
        <Field label="Premises address (as on licence)" className="md:col-span-2">
          <Input value={f.fssaiLicenseAddress} onChange={(e) => set('fssaiLicenseAddress', e.target.value)} />
        </Field>

        <Field label="Issued on">
          <Input type="date" value={f.fssaiIssuedOn} onChange={(e) => set('fssaiIssuedOn', e.target.value)} />
        </Field>
        <Field label="Last renewed on">
          <Input type="date" value={f.fssaiRenewedOn} onChange={(e) => set('fssaiRenewedOn', e.target.value)} />
        </Field>
        <Field label="Expires on" className="md:col-span-2">
          <Input type="date" value={f.fssaiExpiresOn} onChange={(e) => set('fssaiExpiresOn', e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            We&apos;ll alert you (in-app, email &amp; SMS) starting 30 days before this date.
          </p>
        </Field>

        <Field label="Notes (kind of business, remarks)" className="md:col-span-2">
          <Input value={f.fssaiLicenseNotes} onChange={(e) => set('fssaiLicenseNotes', e.target.value)} />
        </Field>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground">Photo of the licence certificate</Label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Shown on your public storefront so customers can verify it. JPG/PNG/WebP, max 8 MB.
        </p>
        <ImageUploader
          value={f.fssaiLicenseImageUrl}
          onChange={(url) => set('fssaiLicenseImageUrl', url)}
          folder="food-licenses"
          aspect="wide"
          recommended="≥ 1600 px wide · clear, readable scan of the full certificate"
        />
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
