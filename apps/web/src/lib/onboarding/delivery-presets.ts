/**
 * Delivery-zone presets for the onboarding delivery step, and a fee preview
 * that follows the same rules as the live engine (computeZoneDelivery in
 * src/server/delivery/zones.ts — a test pins the two together). Money in the
 * zone payload is PAISE (feeBrackets / distanceTiers); the UI works in rupees.
 */

export interface PresetValues {
  radiusKm: number;
  /** Flat / base delivery fee in ₹ (0 = free). */
  baseFee: number;
  /** Distance slabs: up to N km → ₹ added on top of the base fee. */
  slabs: { uptoKm: number; fee: number }[];
  /** Order value (₹) above which delivery is free; null = never. */
  freeAbove: number | null;
  minOrder: number | null;
  etaMinutes: number;
}

export interface DeliveryPreset {
  id: 'flat-3km' | 'distance-slabs' | 'free-above';
  title: string;
  summary: string;
  values: PresetValues;
}

export const DELIVERY_PRESETS: readonly DeliveryPreset[] = [
  {
    id: 'flat-3km',
    title: '3 km, flat ₹30',
    summary: 'Simple and predictable — ideal for a dense neighbourhood.',
    values: { radiusKm: 3, baseFee: 30, slabs: [], freeAbove: null, minOrder: 149, etaMinutes: 30 },
  },
  {
    id: 'distance-slabs',
    title: 'Distance slabs up to 8 km',
    summary: '₹20 up to 2 km, ₹35 up to 5 km, ₹50 up to 8 km.',
    values: { radiusKm: 8, baseFee: 0, slabs: [{ uptoKm: 2, fee: 20 }, { uptoKm: 5, fee: 35 }, { uptoKm: 8, fee: 50 }], freeAbove: null, minOrder: 199, etaMinutes: 40 },
  },
  {
    id: 'free-above',
    title: '5 km, free above ₹499',
    summary: '₹40 delivery, free on bigger orders — nudges larger baskets.',
    values: { radiusKm: 5, baseFee: 40, slabs: [], freeAbove: 499, minOrder: null, etaMinutes: 35 },
  },
];

const paise = (rupees: number) => Math.round(rupees * 100);

/** Body for POST /api/admin/delivery-zones (a CIRCLE around the branch). */
export function presetToZoneBody(p: PresetValues, branch: { id: string; latitude: number; longitude: number }, name: string) {
  const feeBrackets = [{ minSubtotal: 0, charge: paise(p.baseFee) }];
  if (p.freeAbove != null && p.freeAbove > 0) feeBrackets.push({ minSubtotal: paise(p.freeAbove), charge: 0 });
  return {
    branchId: branch.id,
    name,
    type: 'CIRCLE' as const,
    centerLat: branch.latitude,
    centerLng: branch.longitude,
    radiusKm: p.radiusKm,
    isActive: true,
    isDefault: false,
    feeBrackets,
    distanceTiers: [...p.slabs].sort((a, b) => a.uptoKm - b.uptoKm).map((s) => ({ uptoKm: s.uptoKm, charge: paise(s.fee) })),
    minOrder: p.minOrder,
    etaMinutes: p.etaMinutes,
  };
}

/** Validate editable preset values; returns a list of plain-language problems. */
export function validatePreset(p: PresetValues): string[] {
  const out: string[] = [];
  if (!(p.radiusKm > 0 && p.radiusKm <= 30)) out.push('Delivery radius must be between 0.5 and 30 km.');
  if (!(p.baseFee >= 0 && p.baseFee <= 500)) out.push('Base fee must be between ₹0 and ₹500.');
  if (p.slabs.some((s) => !(s.uptoKm > 0) || !(s.fee >= 0))) out.push('Each slab needs a distance above 0 km and a fee of ₹0 or more.');
  if (p.slabs.some((s) => s.uptoKm > p.radiusKm)) out.push('A slab reaches beyond the delivery radius — shorten it or widen the radius.');
  if (p.freeAbove != null && !(p.freeAbove > 0)) out.push('"Free above" must be a positive order value.');
  if (p.minOrder != null && !(p.minOrder >= 0)) out.push('Minimum order cannot be negative.');
  if (!(p.etaMinutes >= 5 && p.etaMinutes <= 180)) out.push('Delivery time should be between 5 and 180 minutes.');
  return out;
}

/** What a customer would pay, using the engine's rules. null ⇒ outside the zone. */
export function previewFee(p: PresetValues, distanceKm: number, subtotal: number): { fee: number; belowMinimum: boolean } | null {
  if (distanceKm > p.radiusKm) return null;
  const body = presetToZoneBody(p, { id: 'x', latitude: 0, longitude: 0 }, 'x');
  const sub = paise(subtotal);
  const bracket = [...body.feeBrackets].sort((a, b) => b.minSubtotal - a.minSubtotal).find((b) => sub >= b.minSubtotal);
  let feePaise = bracket ? bracket.charge : 0;
  const tier = body.distanceTiers.find((t) => distanceKm <= t.uptoKm);
  if (tier && tier.charge > 0) feePaise += tier.charge;
  return { fee: feePaise / 100, belowMinimum: p.minOrder != null && subtotal < p.minOrder };
}
