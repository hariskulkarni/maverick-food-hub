/**
 * Go-live readiness rules (pure). The server loads a ReadinessSnapshot from
 * the real tables (src/server/onboarding.ts) and this module decides which
 * checks pass. Required checks block "Go live"; recommended ones only warn.
 */
import type { OnboardingStepKey } from './steps';
import { validateFssai, validateGstin, validateIndianPhone, validatePinCode } from './validators';

export interface SnapshotBranch {
  id: string;
  name: string;
  line1: string;
  city: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number;
  fssaiLicenseNumber: string | null;
  fssaiExpiresOn: Date | string | null;
  /** OperatingHours rows saved (0 ⇒ the resolver treats the branch as always open). */
  hourRows: number;
  /** Days with an open window (a closed day is stored as openMin = closeMin = 0; overnight windows count). */
  openDays: number;
  activeZones: number;
}

export interface ReadinessSnapshot {
  restaurant: {
    name: string;
    contactPhone: string | null;
    logoUrl: string | null;
    gstin: string | null;
  };
  /** ACTIVE branches only. */
  branches: SnapshotBranch[];
  /** Available, priced items in active categories of active branches. */
  availableItems: number;
  /** Staff (ADMIN/KITCHEN) other than the owner. */
  otherStaff: number;
  hasQr: boolean;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  required: boolean;
  ok: boolean;
  /** Plain-language status / what to fix. */
  detail: string;
  step: OnboardingStepKey;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  ready: boolean;
  requiredFailing: number;
}

function branchList(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export function evaluateReadiness(s: ReadinessSnapshot, now: Date = new Date()): ReadinessResult {
  const checks: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => checks.push(c);
  const b = s.branches;
  const noBranch = b.length === 0;

  // ── Profile ──
  const phoneErr = validateIndianPhone(s.restaurant.contactPhone, { required: true });
  const nameOk = s.restaurant.name.trim().length >= 2;
  add({
    key: 'profile', label: 'Restaurant name and contact phone', required: true, step: 'profile',
    ok: nameOk && !phoneErr,
    detail: !nameOk ? 'Add your restaurant name.' : phoneErr ?? 'Customers and riders can reach you.',
  });
  add({
    key: 'logo', label: 'Logo uploaded', required: false, step: 'profile',
    ok: !!s.restaurant.logoUrl,
    detail: s.restaurant.logoUrl ? 'Your logo shows on the storefront and order updates.' : 'Restaurants with a logo get noticeably more taps — add one when you can.',
  });

  // ── Branch address ──
  const badAddress = b.filter((x) => !x.line1.trim() || !x.city.trim() || validatePinCode(x.postalCode) || x.latitude == null || x.longitude == null);
  add({
    key: 'branch', label: 'At least one active branch with address and map pin', required: true, step: 'branches',
    ok: !noBranch && badAddress.length === 0,
    detail: noBranch ? 'No active branch yet — add your first location.'
      : badAddress.length ? `Fix the address, PIN code or map pin for ${branchList(badAddress.map((x) => x.name))}.`
      : `${b.length} active branch${b.length === 1 ? '' : 'es'} ready.`,
  });

  // ── FSSAI ──
  const fssaiBad = b.filter((x) => validateFssai(x.fssaiLicenseNumber));
  const expired = b.filter((x) => !validateFssai(x.fssaiLicenseNumber) && x.fssaiExpiresOn && new Date(x.fssaiExpiresOn).getTime() < now.getTime());
  add({
    key: 'fssai', label: 'Valid FSSAI licence for every branch', required: true, step: 'legal',
    ok: !noBranch && fssaiBad.length === 0 && expired.length === 0,
    detail: noBranch ? 'Add a branch first — FSSAI licences are issued per premises.'
      : fssaiBad.length ? `Add a 14-digit FSSAI number for ${branchList(fssaiBad.map((x) => x.name))}.`
      : expired.length ? `The FSSAI licence for ${branchList(expired.map((x) => x.name))} has expired — upload the renewed one.`
      : 'Licence on file for every branch.',
  });

  // ── GSTIN (optional but validated) ──
  const gstErr = validateGstin(s.restaurant.gstin);
  add({
    key: 'gstin', label: 'GSTIN added', required: false, step: 'legal',
    ok: !!s.restaurant.gstin && !gstErr,
    detail: gstErr ?? (s.restaurant.gstin ? 'GSTIN appears on your settlement reports.' : 'Needed once your turnover crosses the GST threshold — add it now if you are registered.'),
  });

  // ── Hours ──
  const noHours = b.filter((x) => x.hourRows === 0);
  const closedAllWeek = b.filter((x) => x.hourRows > 0 && x.openDays === 0);
  add({
    key: 'hours', label: 'Opening hours set', required: true, step: 'branches',
    ok: !noBranch && noHours.length === 0 && closedAllWeek.length === 0,
    detail: noBranch ? 'Add a branch first.'
      : noHours.length ? `No hours saved for ${branchList(noHours.map((x) => x.name))} — right now customers could order at any time of day.`
      : closedAllWeek.length ? `${branchList(closedAllWeek.map((x) => x.name))} is closed every day — set at least one open day.`
      : 'Customers can only order while you are open.',
  });

  // ── Menu ──
  add({
    key: 'menu', label: 'At least one dish available to order', required: true, step: 'menu',
    ok: s.availableItems >= 1,
    detail: s.availableItems >= 1 ? `${s.availableItems} dish${s.availableItems === 1 ? '' : 'es'} available.`
      : 'Add a dish with a price above ₹0 and mark it available.',
  });

  // ── Delivery ──
  const noDelivery = b.filter((x) => x.activeZones === 0 && !(x.latitude != null && x.longitude != null && x.serviceRadiusKm > 0));
  const zoned = b.filter((x) => x.activeZones > 0).length;
  add({
    key: 'delivery', label: 'Delivery area set', required: true, step: 'delivery',
    ok: !noBranch && noDelivery.length === 0,
    detail: noBranch ? 'Add a branch first.'
      : noDelivery.length ? `Set a delivery zone (or a map pin + radius) for ${branchList(noDelivery.map((x) => x.name))}.`
      : zoned === b.length ? 'Delivery zones configured.'
      : 'Using the basic radius + per-km fee. Add a zone for precise areas and fee slabs.',
  });

  // ── Staff ──
  add({
    key: 'staff', label: 'Kitchen or manager login added', required: false, step: 'staff',
    ok: s.otherStaff > 0,
    detail: s.otherStaff > 0 ? `${s.otherStaff} team member${s.otherStaff === 1 ? '' : 's'} can see orders.` : 'Only you can see incoming orders. Add a kitchen login so orders are never missed.',
  });

  // ── QR ──
  add({
    key: 'qr', label: 'Storefront QR code generated', required: false, step: 'storefront',
    ok: s.hasQr,
    detail: s.hasQr ? 'Print it for your counter and packaging.' : 'Generate a QR code customers can scan to order directly.',
  });

  const requiredFailing = checks.filter((c) => c.required && !c.ok).length;
  return { checks, ready: requiredFailing === 0, requiredFailing };
}
